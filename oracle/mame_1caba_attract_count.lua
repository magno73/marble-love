-- mame_1caba_attract_count.lua — count entries to FUN_1CABA + log writes to
-- STRUCT @ 0x401C28..0x401C47 in the attract window f11998..f12100.
-- Also log the FIRST 5 entries' full input state (D regs, globals, struct_pre)
-- and the corresponding exit state (struct_post).
--
-- Output: /tmp/mame_1caba_attract_count.json
-- Vars env:
--   MARBLE_TRACE_FROM (default 11998)
--   MARBLE_TRACE_TO   (default 12100)

local function getenv(name, default)
    local v = os.getenv(name)
    if v == nil or v == "" then return default end
    return v
end

local FROM_FR = tonumber(getenv("MARBLE_TRACE_FROM", "11998"))
local TO_FR   = tonumber(getenv("MARBLE_TRACE_TO",   "12100"))
local OUT_PATH = getenv("MARBLE_TRACE_OUT", "/tmp/mame_1caba_attract_count.json")
local MAX_FULL = tonumber(getenv("MARBLE_FULL_MAX", "5"))

local cpu = nil
local mem = nil
local cpu_pc = nil
local slapstic_dev = nil
local frame_count = 0
local installed = false

local entry_count = 0
local exit_count = 0
local struct_writes = 0
local entry_frames = {}
local exit_frames = {}
local entries_full = {}
local pending_entry = nil

local function read_current_bank()
    if slapstic_dev == nil then return -1 end
    -- Try memory_view membank approach: read the active bank directly via
    -- the underlying memory view, since MAME's slapstic device does memory
    -- bank switching via mem:install_*_tap. Returns -1 if not available.
    -- The slapstic device implements bank tracking internally; expose via items.
    if slapstic_dev.items then
        for _, name in ipairs({"m_current_bank", "current_bank", "bank"}) do
            local v = slapstic_dev.items[name]
            if v ~= nil then return v end
        end
    end
    return -1
end

local function read_regs()
    local d, a = {}, {}
    for i = 0, 7 do
        d[i+1] = cpu.state[string.format("D%d", i)].value
        a[i+1] = cpu.state[string.format("A%d", i)].value
    end
    return d, a
end

local function snapshot_struct(addr)
    local t = {}
    for i = 0, 15 do
        t[i+1] = mem:read_u16(addr + i*2)
    end
    return t
end

local function snapshot_bytes(addr, size)
    local t = {}
    for i = 0, size - 1 do
        t[i+1] = mem:read_u8(addr + i)
    end
    return t
end

local function bytes_to_hex(t)
    local parts = {}
    for i, b in ipairs(t) do parts[i] = string.format("%02x", b) end
    return table.concat(parts)
end
local function words_to_hex(t)
    local parts = {}
    for i, w in ipairs(t) do parts[i] = string.format("%04x", w) end
    return table.concat(parts)
end

local function install()
    -- Entry tap @ 0x1CABA (PC fires there)
    mem:install_read_tap(0x1CABA, 0x1CABB, "1caba_entry_attract", function(o, d)
        if frame_count < FROM_FR or frame_count > TO_FR then return d end
        if cpu_pc.value ~= 0x1CABA then return d end
        entry_count = entry_count + 1
        table.insert(entry_frames, frame_count)
        if entry_count <= MAX_FULL then
            local dr, ar = read_regs()
            pending_entry = {
                frame = frame_count,
                d = dr,
                a = ar,
                tileX = mem:read_u16(0x400696),
                tileY = mem:read_u16(0x400698),
                lvlPtr = mem:read_u32(0x400474),
                bsearchPtr = mem:read_u32(0x40065A),
                struct_pre = snapshot_struct(0x401C28),
                colBase = snapshot_bytes(0x400478, 0x200),
                bsearchAlt = snapshot_bytes(0x40076E, 0x200),
                slapstic_bank_pre = read_current_bank(),
                -- Capture playfield long @ 0xa00ed6 — the exact long sub1CABA reads.
                -- More general: capture a small window (256 bytes) around the
                -- access. Cheaper than full 8KB playfield snapshot.
                pf_window_ed0 = snapshot_bytes(0xa00ed0, 0x20),
            }
        else
            pending_entry = nil
        end
        return d
    end)
    -- Exit tap @ 0x1CC5E (PC after RTS load)
    mem:install_read_tap(0x1CC5E, 0x1CC5F, "1caba_exit_attract", function(o, d)
        if frame_count < FROM_FR or frame_count > TO_FR then return d end
        if cpu_pc.value ~= 0x1CC5E then return d end
        exit_count = exit_count + 1
        table.insert(exit_frames, frame_count)
        if pending_entry ~= nil then
            local struct_post = snapshot_struct(0x401C28)
            pending_entry.struct_post = struct_post
            table.insert(entries_full, pending_entry)
            pending_entry = nil
        end
        return d
    end)
    -- Struct write tap
    mem:install_write_tap(0x401C28, 0x401C47, "struct_write_attract", function(o, d, m)
        if frame_count < FROM_FR or frame_count > TO_FR then return end
        struct_writes = struct_writes + 1
    end)
end

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
        cpu_pc = cpu.state["PC"]
        for _, tag in ipairs({":slapstic", ":maincpu:slapstic", ":slapstic_103"}) do
            if manager.machine.devices[tag] ~= nil then
                slapstic_dev = manager.machine.devices[tag]
                print(string.format("[1caba_attract] slapstic device tag: %s", tag))
                break
            end
        end
    end

    frame_count = frame_count + 1

    if frame_count == FROM_FR - 1 and not installed then
        install()
        installed = true
        print(string.format("[1caba_attract] installed frames=%d..%d", FROM_FR, TO_FR))
    end

    if frame_count > TO_FR then
        local f = assert(io.open(OUT_PATH, "w"))
        f:write("{\n")
        f:write(string.format('  "from_frame": %d,\n', FROM_FR))
        f:write(string.format('  "to_frame": %d,\n', TO_FR))
        f:write(string.format('  "entry_count": %d,\n', entry_count))
        f:write(string.format('  "exit_count": %d,\n', exit_count))
        f:write(string.format('  "struct_writes": %d,\n', struct_writes))
        f:write('  "entry_frames_first50": [')
        for i = 1, math.min(#entry_frames, 50) do
            if i > 1 then f:write(",") end
            f:write(tostring(entry_frames[i]))
        end
        f:write("],\n")
        f:write('  "entries_full": [\n')
        for i, e in ipairs(entries_full) do
            local sep = (i < #entries_full) and "," or ""
            local d_str, a_str = {}, {}
            for j = 1, 8 do
                d_str[j] = string.format('"0x%08x"', e.d[j])
                a_str[j] = string.format('"0x%08x"', e.a[j])
            end
            f:write(string.format(
                '    {\n' ..
                '      "frame": %d,\n' ..
                '      "d": [%s],\n' ..
                '      "a": [%s],\n' ..
                '      "tileX": "0x%04x",\n' ..
                '      "tileY": "0x%04x",\n' ..
                '      "lvlPtr": "0x%08x",\n' ..
                '      "bsearchPtr": "0x%08x",\n' ..
                '      "struct_pre": "%s",\n' ..
                '      "struct_post": "%s",\n' ..
                '      "colBase": "%s",\n' ..
                '      "bsearchAlt": "%s",\n' ..
                '      "slapstic_bank_pre": %d\n' ..
                '    }%s\n',
                e.frame, table.concat(d_str, ","), table.concat(a_str, ","),
                e.tileX, e.tileY, e.lvlPtr, e.bsearchPtr,
                words_to_hex(e.struct_pre), words_to_hex(e.struct_post or {}),
                bytes_to_hex(e.colBase), bytes_to_hex(e.bsearchAlt),
                e.slapstic_bank_pre or -1,
                sep
            ))
        end
        f:write('  ]\n}\n')
        f:close()
        print(string.format("[1caba_attract] DONE entries=%d exits=%d struct_writes=%d -> %s",
            entry_count, exit_count, struct_writes, OUT_PATH))
        manager.machine:exit()
    end
end)
