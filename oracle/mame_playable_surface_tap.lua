-- mame_playable_surface_tap.lua — trace the live surface/height path while
-- composing with mame_playable_input_capture.lua.
--
-- Use this for MAME-responsive candidates where TS diverges before death:
-- it logs entry PCs around FUN_121B8/FUN_1BAB2/FUN_1CABA/FUN_1CC62/FUN_160F6
-- and writes to obj0 z/vz/state plus the terrain projection struct 0x401C28.

local function getenv(name, fallback)
    local v = os.getenv(name)
    if v == nil or v == "" then return fallback end
    return v
end

local FROM_FR = tonumber(getenv("MARBLE_SURFACE_TRACE_FROM", "3220"))
local TO_FR = tonumber(getenv("MARBLE_SURFACE_TRACE_TO", "3230"))
local OUT_PATH = getenv("MARBLE_SURFACE_TRACE_OUT", "/private/tmp/marble-surface-trace.json")
local MAX_EVENTS = tonumber(getenv("MARBLE_SURFACE_TRACE_MAX_EVENTS", "5000"))
local PLAYABLE_CAPTURE = getenv("MARBLE_SURFACE_TRACE_PLAYABLE_CAPTURE", "1") == "1"

local cpu = nil
local mem = nil
local pc_state = nil
local frame_count = 0
local installed = false
local finished = false
local seq = 0
local events = {}
local tap_handles = {}

local PCS = {
    { pc = 0x0121b8, name = "FUN_121B8_entry" },
    { pc = 0x01bab2, name = "FUN_1BAB2_entry" },
    { pc = 0x01caba, name = "FUN_1CABA_entry" },
    { pc = 0x01cc5e, name = "FUN_1CABA_exit" },
    { pc = 0x01cc62, name = "FUN_1CC62_entry" },
    { pc = 0x0160f6, name = "FUN_160F6_entry" },
}

local WATCHES = {
    { lo = 0x400020, hi = 0x400023, name = "obj0_vz" },
    { lo = 0x40002c, hi = 0x40002f, name = "obj0_z" },
    { lo = 0x400046, hi = 0x400049, name = "obj0_snap_tile" },
    { lo = 0x40004e, hi = 0x40004f, name = "obj0_state36_37" },
    { lo = 0x400696, hi = 0x4006a7, name = "sprite_globals" },
    { lo = 0x401c28, hi = 0x401c47, name = "surface_struct" },
}

local function ensure_dir(path)
    local dir = string.match(path, "^(.*)/[^/]+$")
    if dir ~= nil and dir ~= "" then os.execute(string.format("mkdir -p %q", dir)) end
end

local function hx(v, width)
    return string.format("0x%0" .. tostring(width) .. "x", v or 0)
end

local function read_u8(addr)
    local ok, value = pcall(function() return mem:read_u8(addr) end)
    if ok then return value end
    return 0
end

local function read_u16(addr)
    local ok, value = pcall(function() return mem:read_u16(addr) end)
    if ok then return value end
    return 0
end

local function read_u32(addr)
    local ok, value = pcall(function() return mem:read_u32(addr) end)
    if ok then return value end
    return 0
end

local function region_hex(addr, len)
    local out = {}
    for i = 0, len - 1 do out[#out + 1] = string.format("%02x", read_u8(addr + i)) end
    return table.concat(out)
end

local function add_event(kind, name, extra)
    if frame_count < FROM_FR or frame_count > TO_FR then return end
    if #events >= MAX_EVENTS then return end
    seq = seq + 1
    local e = {
        seq = seq,
        f = frame_count,
        kind = kind,
        name = name,
        pc = pc_state.value,
        d0 = cpu.state["D0"].value,
        d1 = cpu.state["D1"].value,
        d2 = cpu.state["D2"].value,
        d3 = cpu.state["D3"].value,
        d4 = cpu.state["D4"].value,
        a0 = cpu.state["A0"].value,
        a1 = cpu.state["A1"].value,
        a2 = cpu.state["A2"].value,
        a3 = cpu.state["A3"].value,
        a4 = cpu.state["A4"].value,
        a5 = cpu.state["A5"].value,
        a6 = cpu.state["A6"].value,
        obj0 = region_hex(0x400018, 0x60),
        globals = region_hex(0x400684, 0x24),
        surface = region_hex(0x401c28, 0x20),
        extra = extra or {},
    }
    events[#events + 1] = e
end

local function add_write_event(name, extra)
    if frame_count < FROM_FR or frame_count > TO_FR then return end
    if #events >= MAX_EVENTS then return end
    seq = seq + 1
    events[#events + 1] = {
        seq = seq,
        f = frame_count,
        kind = "write",
        name = name,
        pc = pc_state.value,
        d0 = cpu.state["D0"].value,
        d1 = cpu.state["D1"].value,
        d2 = cpu.state["D2"].value,
        d3 = cpu.state["D3"].value,
        d4 = cpu.state["D4"].value,
        a0 = cpu.state["A0"].value,
        a1 = cpu.state["A1"].value,
        a2 = cpu.state["A2"].value,
        a3 = cpu.state["A3"].value,
        a4 = cpu.state["A4"].value,
        a5 = cpu.state["A5"].value,
        a6 = cpu.state["A6"].value,
        obj0 = "",
        globals = "",
        surface = "",
        extra = extra or {},
    }
end

local function install_pc_tap(pc, name)
    local handle = mem:install_read_tap(pc, pc + 1, "surface_pc_" .. name, function(o, d, m)
        if pc_state.value == pc then add_event("pc", name, {}) end
        return d
    end)
    tap_handles[#tap_handles + 1] = handle
end

local function install_write_tap(lo, hi, name)
    local handle = mem:install_write_tap(lo, hi, "surface_write_" .. name, function(o, d, m)
        add_write_event(name, {
            addr = o,
            data = d,
            mask = m,
        })
    end)
    tap_handles[#tap_handles + 1] = handle
end

local function json_event(e, indent)
    local ex = e.extra or {}
    local extra_parts = {}
    for k, v in pairs(ex) do
        if type(v) == "number" then
            extra_parts[#extra_parts + 1] = string.format('"%s":"%s"', k, hx(v, 8))
        end
    end
    table.sort(extra_parts)
    return string.format(
        '%s{"seq":%d,"f":%d,"kind":"%s","name":"%s","pc":"%s",' ..
        '"d0":"%s","d1":"%s","d2":"%s","d3":"%s","d4":"%s",' ..
        '"a0":"%s","a1":"%s","a2":"%s","a3":"%s","a4":"%s","a5":"%s","a6":"%s",' ..
        '"obj0":"%s","globals":"%s","surface":"%s","extra":{%s}}',
        indent,
        e.seq,
        e.f,
        e.kind,
        e.name,
        hx(e.pc, 6),
        hx(e.d0, 8),
        hx(e.d1, 8),
        hx(e.d2, 8),
        hx(e.d3, 8),
        hx(e.d4, 8),
        hx(e.a0, 8),
        hx(e.a1, 8),
        hx(e.a2, 8),
        hx(e.a3, 8),
        hx(e.a4, 8),
        hx(e.a5, 8),
        hx(e.a6, 8),
        e.obj0,
        e.globals,
        e.surface,
        table.concat(extra_parts, ",")
    )
end

local function write_json()
    ensure_dir(OUT_PATH)
    local f = assert(io.open(OUT_PATH, "w"))
    f:write("{\n")
    f:write(string.format('  "fromFrame": %d,\n', FROM_FR))
    f:write(string.format('  "toFrame": %d,\n', TO_FR))
    f:write(string.format('  "eventCount": %d,\n', #events))
    f:write('  "events": [\n')
    for i, e in ipairs(events) do
        local sep = (i < #events) and "," or ""
        f:write(json_event(e, "    ") .. sep .. "\n")
    end
    f:write("  ]\n")
    f:write("}\n")
    f:close()
end

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
        pc_state = cpu.state["PC"]
    end

    frame_count = frame_count + 1

    if frame_count == FROM_FR - 1 and not installed then
        for _, p in ipairs(PCS) do install_pc_tap(p.pc, p.name) end
        for _, w in ipairs(WATCHES) do install_write_tap(w.lo, w.hi, w.name) end
        installed = true
        print(string.format("[surface_tap] installed frames=%d..%d out=%s", FROM_FR, TO_FR, OUT_PATH))
    end

    if frame_count >= TO_FR and not finished then
        finished = true
        write_json()
        print(string.format("[surface_tap] DONE events=%d -> %s", #events, OUT_PATH))
        manager.machine:exit()
    end
end)

if PLAYABLE_CAPTURE then
    dofile("oracle/mame_playable_input_capture.lua")
end
