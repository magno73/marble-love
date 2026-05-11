-- mame_1caba_trace.lua — hook entry/exit di FUN_0001CABA via install_read_tap.
-- Cattura stato (workRam, STRUCT, registri tile) prima e dopo ogni call.
-- Output JSON.
--
-- Variabili d'ambiente:
--   MARBLE_1CABA_FRAMES    — CSV di frame numeri (default 12000..12004)
--   MARBLE_1CABA_OUT       — file output (default /tmp/mame_1caba_trace.json)
--   MARBLE_1CABA_MAXCALLS  — max calls per frame (default 200)

local FRAMES_RAW = os.getenv("MARBLE_1CABA_FRAMES") or "12000,12001,12002,12003,12004"
local OUT_PATH = os.getenv("MARBLE_1CABA_OUT") or "/tmp/mame_1caba_trace.json"
local MAX_CALLS = tonumber(os.getenv("MARBLE_1CABA_MAXCALLS") or "300")

local TARGET_FRAMES = {}
local TARGET_SET = {}
for tok in string.gmatch(FRAMES_RAW, "([^,]+)") do
    local f = tonumber(tok)
    if f ~= nil then
        table.insert(TARGET_FRAMES, f)
        TARGET_SET[f] = true
    end
end
table.sort(TARGET_FRAMES)
local LAST_FRAME = TARGET_FRAMES[#TARGET_FRAMES]

local FUN_1CABA_ENTRY = 0x1CABA
-- The RTS at end of FUN_1CABA is at 0x1CC5E (1 word, opcode 0x4E75).
local FUN_1CABA_RTS = 0x1CC5E

local cpu = nil
local mem = nil
local frame_count = 0
local calls = {}
local pending_entry = nil
local installed = false

local function hex_region(addr, size)
    local parts = {}
    for i = 0, size - 1 do
        parts[i + 1] = string.format("%02x", mem:read_u8(addr + i))
    end
    return table.concat(parts)
end

local function read_word_be(addr)
    return mem:read_u16(addr)
end
local function read_long_be(addr)
    return mem:read_u32(addr)
end

local function capture_entry_state()
    local lvlPtr = read_long_be(0x400474)
    local maxBound = 0
    if lvlPtr ~= 0 and lvlPtr < 0xFFFFFF then
        local ok, v = pcall(read_word_be, lvlPtr + 0x18)
        if ok then maxBound = v end
    end
    return {
        frame = frame_count,
        tileX = read_word_be(0x400696),
        tileY = read_word_be(0x400698),
        lvlPtr = lvlPtr,
        bsearchPtr = read_long_be(0x40065A),
        maxBound = maxBound,
        struct_pre = hex_region(0x401C28, 32),
        colBase = hex_region(0x400478, 0x100),
        bsearchAlt = hex_region(0x40076E, 0x100),
        pf_partial = hex_region(0xA00000, 0x800),
    }
end

local debug_total_entry = 0
local function on_entry_tap()
    debug_total_entry = debug_total_entry + 1
    if not TARGET_SET[frame_count] then return end
    if #calls >= MAX_CALLS * #TARGET_FRAMES then return end
    if pending_entry ~= nil then return end  -- already captured
    pending_entry = capture_entry_state()
end

local function on_exit_tap()
    if pending_entry == nil then return end
    if not TARGET_SET[frame_count] then
        pending_entry = nil
        return
    end
    local exit_struct = hex_region(0x401C28, 32)
    table.insert(calls, {
        entry = pending_entry,
        exit_struct = exit_struct,
    })
    pending_entry = nil
end

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
    end
    if not installed then
        mem:install_read_tap(FUN_1CABA_ENTRY, FUN_1CABA_ENTRY + 1, "1caba_entry",
            function(offset, data)
                if offset == FUN_1CABA_ENTRY and pending_entry == nil then
                    on_entry_tap()
                end
                return data
            end)
        mem:install_read_tap(FUN_1CABA_RTS, FUN_1CABA_RTS + 1, "1caba_exit",
            function(offset, data)
                if offset == FUN_1CABA_RTS and pending_entry ~= nil then
                    on_exit_tap()
                end
                return data
            end)
        installed = true
    end

    -- Reset prefetch dedup flags after each frame; m68k often prefetches
    -- 1 word ahead, so a single call generates two reads at the same addr.
    -- Resetting per-frame is too coarse; reset between entry/exit cycle.
    frame_count = frame_count + 1
    pending_entry = nil  -- ensure no leak across frame boundary

    if frame_count >= LAST_FRAME then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write("{\n")
        out:write(string.format('  "total_calls": %d,\n', #calls))
        out:write('  "calls": [\n')
        for i, c in ipairs(calls) do
            local sep = (i < #calls) and "," or ""
            out:write(string.format(
                '    {\n' ..
                '      "frame": %d,\n' ..
                '      "tileX": "%04x", "tileY": "%04x",\n' ..
                '      "lvlPtr": "%x", "bsearchPtr": "%x", "maxBound": "%04x",\n' ..
                '      "struct_pre": "%s",\n' ..
                '      "struct_post": "%s",\n' ..
                '      "colBase": "%s",\n' ..
                '      "bsearchAlt": "%s",\n' ..
                '      "pf_partial": "%s"\n' ..
                '    }%s\n',
                c.entry.frame,
                c.entry.tileX, c.entry.tileY,
                c.entry.lvlPtr, c.entry.bsearchPtr, c.entry.maxBound,
                c.entry.struct_pre, c.exit_struct,
                c.entry.colBase, c.entry.bsearchAlt, c.entry.pf_partial,
                sep
            ))
        end
        out:write('  ]\n')
        out:write("}\n")
        out:close()
        print(string.format("[mame_1caba_trace] total entry hits=%d saved %d calls to %s",
            debug_total_entry, #calls, OUT_PATH))
        manager.machine:exit()
    end
end)
