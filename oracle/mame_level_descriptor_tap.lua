-- mame_level_descriptor_tap.lua — trace ROM level descriptor loads in MAME.
--
-- This probe does not patch game state. It can be run standalone, or it can
-- compose with mame_playable_input_capture.lua so descriptor traces match the
-- same scripted/manual/playback input route used for scenario captures.
-- It records the current level descriptor pointer at 0x400474, dispatcher/init
-- entry points, and frame-level state transitions so attract/manual/playback
-- routes can be audited before promoting any startLevel seed.
--
-- Environment:
--   MARBLE_DESCRIPTOR_TRACE_FROM        first frame to record (default 1)
--   MARBLE_DESCRIPTOR_TRACE_TO          last frame before exit (default 120000)
--   MARBLE_DESCRIPTOR_TRACE_OUT         output JSON path
--   MARBLE_DESCRIPTOR_TRACE_SAMPLE_EVERY periodic frame sample interval (default 300)
--   MARBLE_DESCRIPTOR_TRACE_MAX_EVENTS  max PC/write events (default 20000)
--   MARBLE_DESCRIPTOR_TRACE_MAX_SAMPLES max frame samples (default 20000)
--   MARBLE_DESCRIPTOR_TRACE_STOP_ON_ALL=1 exit once L1..L6 pointers were seen
--   MARBLE_DESCRIPTOR_TRACE_INPUT_TAPS=1 observe raw input reads in this probe
--   MARBLE_DESCRIPTOR_TRACE_PLAYABLE_CAPTURE=1 also load playable input capture

local function getenv(name, fallback)
    local v = os.getenv(name)
    if v == nil or v == "" then return fallback end
    return v
end

local FROM_FR = tonumber(getenv("MARBLE_DESCRIPTOR_TRACE_FROM", "1"))
local TO_FR = tonumber(getenv("MARBLE_DESCRIPTOR_TRACE_TO", "120000"))
local OUT_PATH = getenv("MARBLE_DESCRIPTOR_TRACE_OUT", "/private/tmp/marble-level-descriptor-trace.json")
local SAMPLE_EVERY = tonumber(getenv("MARBLE_DESCRIPTOR_TRACE_SAMPLE_EVERY", "300"))
local MAX_EVENTS = tonumber(getenv("MARBLE_DESCRIPTOR_TRACE_MAX_EVENTS", "20000"))
local MAX_SAMPLES = tonumber(getenv("MARBLE_DESCRIPTOR_TRACE_MAX_SAMPLES", "20000"))
local STOP_ON_ALL = getenv("MARBLE_DESCRIPTOR_TRACE_STOP_ON_ALL", "0") == "1"
local INPUT_TAPS = getenv("MARBLE_DESCRIPTOR_TRACE_INPUT_TAPS", "0") == "1"
local PLAYABLE_CAPTURE = getenv("MARBLE_DESCRIPTOR_TRACE_PLAYABLE_CAPTURE", "0") == "1"

local DESCRIPTORS = {
    { level = 1, ptr = 0x0002bee2 },
    { level = 2, ptr = 0x0002c54c },
    { level = 3, ptr = 0x0002cd9e },
    { level = 4, ptr = 0x0002d648 },
    { level = 5, ptr = 0x0002de1e },
    { level = 6, ptr = 0x0002e790 },
}

local LEVEL_BY_PTR = {}
for _, d in ipairs(DESCRIPTORS) do
    LEVEL_BY_PTR[d.ptr] = d.level
end

local PCS = {
    { pc = 0x010504, name = "FUN_10504_main_loop_init" },
    { pc = 0x011452, name = "FUN_11452_mode2_init" },
    { pc = 0x016ec6, name = "FUN_16EC6_level_dispatcher" },
    { pc = 0x016f6c, name = "FUN_16F6C_level_init" },
    { pc = 0x01a236, name = "FUN_1A236_init_level_load" },
    { pc = 0x01a444, name = "FUN_1A444_tilemap_rows" },
}

local cpu = nil
local mem = nil
local pc_state = nil
local sp_state = nil
local frame_count = 0
local installed = false
local seq = 0

local events = {}
local samples = {}
local pointer_counts = {}
local pointer_windows = {}
local current_pointer_key = nil
local current_pointer_start = nil
local current_pointer_last = nil
local pointer_windows_closed = false
local first_seen = {}
local last_seen = {}
local seen_levels = {}
local seen_level_count = 0
local last_signature = nil
local last_pc_key = nil
local tap_handles = {}

local INPUT_DEFAULTS = {
    [0xF20001] = 0xff,
    [0xF20003] = 0xff,
    [0xF20005] = 0xff,
    [0xF20007] = 0xff,
    [0xF60001] = 0x6f,
    [0xFC0001] = 0xff,
    [0xFE0001] = 0xff,
}

local input_current = {}
for addr, value in pairs(INPUT_DEFAULTS) do
    input_current[addr] = value
end

local function ensure_dir(path)
    local dir = string.match(path, "^(.*)/[^/]+$")
    if dir ~= nil and dir ~= "" then
        os.execute(string.format("mkdir -p %q", dir))
    end
end

local function hx(v, width)
    return string.format("0x%0" .. tostring(width) .. "x", v or 0)
end

local function label_for_ptr(ptr)
    local level = LEVEL_BY_PTR[ptr]
    if level ~= nil then return "L" .. tostring(level) end
    if ptr == 0 then return "null" end
    return "unknown"
end

local function ptr_from_key(key)
    local hex = string.match(key, "^0x(.+)$")
    if hex ~= nil then return tonumber(hex, 16) or 0 end
    return tonumber(key) or 0
end

local function safe_u8(addr)
    local ok, v = pcall(function() return mem:read_u8(addr) end)
    if ok then return v end
    return 0
end

local function safe_u16(addr)
    local ok, v = pcall(function() return mem:read_u16(addr) end)
    if ok then return v end
    return 0
end

local function safe_u32(addr)
    local ok, v = pcall(function() return mem:read_u32(addr) end)
    if ok then return v end
    return 0
end

local function state_snapshot(kind, name)
    local ptr = safe_u32(0x400474)
    local level = LEVEL_BY_PTR[ptr] or 0
    return {
        kind = kind,
        name = name or "",
        frame = frame_count,
        seq = seq,
        pc = pc_state and pc_state.value or 0,
        sp = sp_state and sp_state.value or 0,
        main = safe_u16(0x400390),
        mode = safe_u16(0x400392),
        levelIndex = safe_u16(0x400394),
        segment = safe_u8(0x4003e4),
        playerState = safe_u16(0x400032),
        playerTimer = safe_u16(0x400082),
        levelPtr = ptr,
        level = level,
        d0 = cpu and cpu.state["D0"].value or 0,
        d1 = cpu and cpu.state["D1"].value or 0,
        d2 = cpu and cpu.state["D2"].value or 0,
        a0 = cpu and cpu.state["A0"].value or 0,
        a1 = cpu and cpu.state["A1"].value or 0,
    }
end

local function add_event(kind, name, extra)
    if frame_count < FROM_FR or frame_count > TO_FR then return end
    if #events >= MAX_EVENTS then return end
    seq = seq + 1
    local s = state_snapshot(kind, name)
    if extra ~= nil then
        for k, v in pairs(extra) do s[k] = v end
    end
    table.insert(events, s)
end

local function add_write_event(name, extra)
    if frame_count < FROM_FR or frame_count > TO_FR then return end
    if #events >= MAX_EVENTS then return end

    -- Keep write taps lightweight. Reading mapped RAM while a write tap is
    -- active can destabilize MAME's tap callback path; frame_done samples carry
    -- the post-write state.
    seq = seq + 1
    local s = {
        kind = "write",
        name = name or "",
        frame = frame_count,
        seq = seq,
        pc = pc_state and pc_state.value or 0,
        sp = sp_state and sp_state.value or 0,
        main = 0,
        mode = 0,
        levelIndex = 0,
        segment = 0,
        playerState = 0,
        playerTimer = 0,
        levelPtr = 0,
        level = 0,
        d0 = cpu and cpu.state["D0"].value or 0,
        d1 = cpu and cpu.state["D1"].value or 0,
        d2 = cpu and cpu.state["D2"].value or 0,
        a0 = cpu and cpu.state["A0"].value or 0,
        a1 = cpu and cpu.state["A1"].value or 0,
    }
    if extra ~= nil then
        for k, v in pairs(extra) do s[k] = v end
    end
    table.insert(events, s)
end

local function add_sample(kind)
    if frame_count < FROM_FR or frame_count > TO_FR then return end
    if #samples >= MAX_SAMPLES then return end
    seq = seq + 1
    table.insert(samples, state_snapshot(kind, ""))
end

local function normalize_tap_addr(base, offset)
    if offset < base then return base + offset end
    return offset
end

local function canonical_input_addr(addr)
    if addr == 0xF20000 then return 0xF20001 end
    if addr == 0xF20002 then return 0xF20003 end
    if addr == 0xF20004 then return 0xF20005 end
    if addr == 0xF20006 then return 0xF20007 end
    if addr == 0xF60000 then return 0xF60001 end
    if addr == 0xFC0000 then return 0xFC0001 end
    if addr == 0xFE0000 then return 0xFE0001 end
    return addr
end

local function install_input_read_tap(lo, hi, name)
    local handle = mem:install_read_tap(lo, hi, "level_descriptor_input_" .. name, function(offset, data, mask)
        local addr = canonical_input_addr(normalize_tap_addr(lo, offset))
        local v = data & 0xff
        input_current[addr] = v & 0xff
        return v & 0xff
    end)
    table.insert(tap_handles, handle)
end

local function install_pc_tap(pc, name)
    local handle = mem:install_read_tap(pc, pc + 1, "level_descriptor_" .. name, function(offset, data, mask)
        if pc_state == nil or pc_state.value ~= pc then return data end
        local sp = sp_state and sp_state.value or 0
        local key = tostring(frame_count) .. ":" .. hx(pc, 6) .. ":" .. hx(sp, 8)
        if key == last_pc_key then return data end
        last_pc_key = key
        add_event("pc", name, { tapPc = pc })
        return data
    end)
    table.insert(tap_handles, handle)
end

local function install_taps()
    if INPUT_TAPS then
        install_input_read_tap(0xF20000, 0xF20007, "trackball")
        install_input_read_tap(0xF60000, 0xF60003, "switches")
        install_input_read_tap(0xFC0000, 0xFC0001, "sound_response")
        install_input_read_tap(0xFE0000, 0xFE0001, "sound_command")
    end
    for _, p in ipairs(PCS) do
        install_pc_tap(p.pc, p.name)
    end
    local ptr_handle = mem:install_write_tap(0x400474, 0x400477, "level_descriptor_ptr_write", function(offset, data, mask)
        local addr = normalize_tap_addr(0x400474, offset)
        add_write_event("workRam[0x474..0x477]", {
            writeAddr = addr,
            writeData = data or 0,
            writeMask = mask or 0,
        })
    end)
    table.insert(tap_handles, ptr_handle)
    local index_handle = mem:install_write_tap(0x400394, 0x400395, "level_descriptor_index_write", function(offset, data, mask)
        local addr = normalize_tap_addr(0x400394, offset)
        add_write_event("workRam[0x394..0x395]", {
            writeAddr = addr,
            writeData = data or 0,
            writeMask = mask or 0,
        })
    end)
    table.insert(tap_handles, index_handle)
end

local function update_pointer_counts()
    if frame_count < FROM_FR or frame_count > TO_FR then return end
    local ptr = safe_u32(0x400474)
    local key = hx(ptr, 8)
    pointer_counts[key] = (pointer_counts[key] or 0) + 1
    if first_seen[key] == nil then first_seen[key] = frame_count end
    last_seen[key] = frame_count

    if current_pointer_key ~= key then
        if current_pointer_key ~= nil then
            table.insert(pointer_windows, {
                ptr = current_pointer_key,
                firstFrame = current_pointer_start,
                lastFrame = current_pointer_last,
                frameCount = current_pointer_last - current_pointer_start + 1,
            })
        end
        current_pointer_key = key
        current_pointer_start = frame_count
        current_pointer_last = frame_count
    else
        current_pointer_last = frame_count
    end

    local level = LEVEL_BY_PTR[ptr]
    if level ~= nil and not seen_levels[level] then
        seen_levels[level] = true
        seen_level_count = seen_level_count + 1
    end
end

local function close_pointer_windows()
    if pointer_windows_closed then return end
    pointer_windows_closed = true
    if current_pointer_key ~= nil then
        table.insert(pointer_windows, {
            ptr = current_pointer_key,
            firstFrame = current_pointer_start,
            lastFrame = current_pointer_last,
            frameCount = current_pointer_last - current_pointer_start + 1,
        })
    end
end

local function update_frame_samples()
    if frame_count < FROM_FR or frame_count > TO_FR then return end
    local ptr = safe_u32(0x400474)
    local signature = table.concat({
        hx(ptr, 8),
        tostring(safe_u16(0x400390)),
        tostring(safe_u16(0x400392)),
        tostring(safe_u16(0x400394)),
        tostring(safe_u8(0x4003e4)),
        tostring(safe_u16(0x400032)),
        tostring(safe_u16(0x400082)),
    }, ":")
    local periodic = SAMPLE_EVERY > 0 and ((frame_count - FROM_FR) % SAMPLE_EVERY == 0)
    if signature ~= last_signature then
        add_sample("state-change")
        last_signature = signature
    elseif periodic then
        add_sample("periodic")
    end
end

local function event_json(s, indent)
    local pad = indent or "    "
    local parts = {
        string.format('"kind":"%s"', s.kind),
        string.format('"name":"%s"', s.name),
        string.format('"frame":%d', s.frame),
        string.format('"seq":%d', s.seq),
        string.format('"pc":"%s"', hx(s.pc, 6)),
        string.format('"sp":"%s"', hx(s.sp, 8)),
        string.format('"main":%d', s.main),
        string.format('"mode":%d', s.mode),
        string.format('"levelIndex":%d', s.levelIndex),
        string.format('"segment":%d', s.segment),
        string.format('"playerState":%d', s.playerState),
        string.format('"playerTimer":%d', s.playerTimer),
        string.format('"levelPtr":"%s"', hx(s.levelPtr, 8)),
        string.format('"levelLabel":"%s"', label_for_ptr(s.levelPtr)),
        string.format('"level":%d', s.level),
        string.format('"d0":"%s"', hx(s.d0, 8)),
        string.format('"d1":"%s"', hx(s.d1, 8)),
        string.format('"d2":"%s"', hx(s.d2, 8)),
        string.format('"a0":"%s"', hx(s.a0, 8)),
        string.format('"a1":"%s"', hx(s.a1, 8)),
    }
    if s.tapPc ~= nil then table.insert(parts, string.format('"tapPc":"%s"', hx(s.tapPc, 6))) end
    if s.writeAddr ~= nil then table.insert(parts, string.format('"writeAddr":"%s"', hx(s.writeAddr, 6))) end
    if s.writeData ~= nil then table.insert(parts, string.format('"writeData":"%s"', hx(s.writeData, 8))) end
    if s.writeMask ~= nil then table.insert(parts, string.format('"writeMask":"%s"', hx(s.writeMask, 8))) end
    return pad .. "{" .. table.concat(parts, ",") .. "}"
end

local function write_json()
    close_pointer_windows()
    ensure_dir(OUT_PATH)
    local out = assert(io.open(OUT_PATH, "w"))
    out:write("{\n")
    out:write('  "schemaVersion": 1,\n')
    out:write('  "source": "mame",\n')
    out:write(string.format('  "fromFrame": %d,\n', FROM_FR))
    out:write(string.format('  "toFrame": %d,\n', math.min(frame_count, TO_FR)))
    out:write(string.format('  "seenLevelCount": %d,\n', seen_level_count))
    out:write('  "descriptors": [\n')
    for i, d in ipairs(DESCRIPTORS) do
        local key = hx(d.ptr, 8)
        local sep = (i < #DESCRIPTORS) and "," or ""
        out:write(string.format(
            '    {"level":%d,"ptr":"%s","frameCount":%d,"firstFrame":%s,"lastFrame":%s}%s\n',
            d.level,
            key,
            pointer_counts[key] or 0,
            first_seen[key] ~= nil and tostring(first_seen[key]) or "null",
            last_seen[key] ~= nil and tostring(last_seen[key]) or "null",
            sep
        ))
    end
    out:write("  ],\n")
    out:write('  "otherPointers": [\n')
    local other_keys = {}
    for key, _ in pairs(pointer_counts) do
        local is_descriptor = false
        for _, d in ipairs(DESCRIPTORS) do
            if key == hx(d.ptr, 8) then is_descriptor = true end
        end
        if not is_descriptor then table.insert(other_keys, key) end
    end
    table.sort(other_keys)
    for i, key in ipairs(other_keys) do
        local sep = (i < #other_keys) and "," or ""
        out:write(string.format(
            '    {"ptr":"%s","label":"%s","frameCount":%d,"firstFrame":%d,"lastFrame":%d}%s\n',
            key,
            label_for_ptr(ptr_from_key(key)),
            pointer_counts[key] or 0,
            first_seen[key] or 0,
            last_seen[key] or 0,
            sep
        ))
    end
    out:write("  ],\n")
    out:write('  "pointerWindows": [\n')
    for i, w in ipairs(pointer_windows) do
        local sep = (i < #pointer_windows) and "," or ""
        out:write(string.format(
            '    {"ptr":"%s","label":"%s","firstFrame":%d,"lastFrame":%d,"frameCount":%d}%s\n',
            w.ptr,
            label_for_ptr(ptr_from_key(w.ptr)),
            w.firstFrame,
            w.lastFrame,
            w.frameCount,
            sep
        ))
    end
    out:write("  ],\n")
    out:write('  "events": [\n')
    for i, s in ipairs(events) do
        local sep = (i < #events) and "," or ""
        out:write(event_json(s, "    ") .. sep .. "\n")
    end
    out:write("  ],\n")
    out:write('  "samples": [\n')
    for i, s in ipairs(samples) do
        local sep = (i < #samples) and "," or ""
        out:write(event_json(s, "    ") .. sep .. "\n")
    end
    out:write("  ]\n")
    out:write("}\n")
    out:close()
end

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
        pc_state = cpu.state["PC"]
        sp_state = cpu.state["SP"]
    end
    if not installed then
        install_taps()
        installed = true
        print(string.format(
            "[level_descriptor_tap] installed, frames=%d..%d sampleEvery=%d out=%s",
            FROM_FR,
            TO_FR,
            SAMPLE_EVERY,
            OUT_PATH
        ))
    end

    frame_count = frame_count + 1
    update_pointer_counts()
    update_frame_samples()

    if frame_count % 30000 == 0 then
        print(string.format(
            "[level_descriptor_tap] f%d seenLevels=%d events=%d samples=%d",
            frame_count,
            seen_level_count,
            #events,
            #samples
        ))
    end

    if (STOP_ON_ALL and seen_level_count >= 6) or frame_count >= TO_FR then
        write_json()
        print(string.format(
            "[level_descriptor_tap] DONE f%d seenLevels=%d events=%d samples=%d -> %s",
            frame_count,
            seen_level_count,
            #events,
            #samples,
            OUT_PATH
        ))
        manager.machine:exit()
    end
end)

if PLAYABLE_CAPTURE then
    dofile("oracle/mame_playable_input_capture.lua")
end
