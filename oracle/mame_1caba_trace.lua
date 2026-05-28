-- mame_1caba_trace.lua — hook entry/exit di FUN_0001CABA via install_read_tap.
-- Captures state (workRam, STRUCT, tile registers) before and after each call.
-- Output JSON.
--
-- Variabili d'ambiente:
--   MARBLE_1CABA_FRAMES    — CSV di frame numeri (default 200..210)
--   MARBLE_1CABA_OUT       — file output (default /tmp/mame_1caba_trace.json)
--   MARBLE_1CABA_MAXCALLS  — max calls totali (default 200)
--   MARBLE_1CABA_RUN_UNTIL - max frame before forcing exit (default = last frame)

local FRAMES_RAW = os.getenv("MARBLE_1CABA_FRAMES") or "200,201,202,203,204,205,206,207,208,209"
local OUT_PATH = os.getenv("MARBLE_1CABA_OUT") or "/tmp/mame_1caba_trace.json"
local MAX_CALLS = tonumber(os.getenv("MARBLE_1CABA_MAXCALLS") or "200")

local TARGET_SET = {}
local LAST_FRAME = 0
for tok in string.gmatch(FRAMES_RAW, "([^,]+)") do
    local f = tonumber(tok)
    if f ~= nil then
        TARGET_SET[f] = true
        if f > LAST_FRAME then LAST_FRAME = f end
    end
end
LAST_FRAME = tonumber(os.getenv("MARBLE_1CABA_RUN_UNTIL") or tostring(LAST_FRAME))

local FUN_1CABA_ENTRY = 0x1CABA
-- The RTS at end of FUN_1CABA is at 0x1CC5E (opcode 0x4E75).
local FUN_1CABA_RTS = 0x1CC5E

local cpu = nil
local mem = nil
local frame_count = 0
local calls = {}
local pending_entry = nil
local last_entry_pc = -1  -- dedup prefetch
local last_exit_pc = -1
local installed = false
local total_entry_hits = 0
local total_exit_hits = 0

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
    if lvlPtr ~= 0 and lvlPtr < 0x88000 then
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
        colBase = hex_region(0x400478, 0x200),
        bsearchAlt = hex_region(0x40076E, 0x200),
        -- pf and bsearch_data filled by capture_entry_state caller
        pf = "",
        bsearch_data = "",
    }
end

local function capture_bsearch_blob(bsearchPtr)
    -- bsearch base may be in workRam (0x400000+) or ROM. Cap dump to 2 KB.
    -- Only dump if pointer lies in known safe ranges.
    local addr = bsearchPtr
    if addr == 0 then return "" end
    local lo, hi = addr, addr + 0x800 - 1
    local in_rom = (hi < 0x88000)
    local in_wram = (lo >= 0x400000 and hi < 0x402000)
    if not (in_rom or in_wram) then return "" end
    return hex_region(addr, 0x800)
end

local function capture_playfield_safe()
    -- Playfield 0xA00000..0xA01FFF — read in pages to avoid bus errors.
    local out = {}
    local page = 0x100
    for base = 0xA00000, 0xA01FFF, page do
        local ok, hex = pcall(hex_region, base, page)
        if ok then
            table.insert(out, hex)
        else
            table.insert(out, string.rep("00", page))
        end
    end
    return table.concat(out)
end

local CAPTURE_ALL = (os.getenv("MARBLE_1CABA_ALL") == "1")

-- Defer heavy state capture out of the tap. The tap just records "we are
-- inside a call to FUN_1CABA": the actual capture happens in the next
-- frame_done callback (which polls pending_entry and snapshots state).
-- This avoids re-entrancy issues when reading large memory regions from
-- inside an active read-tap callback (observed to silently disable the tap).
local pending_marker = false
local pending_marker_frame = -1

local function on_entry_tap(offset)
    total_entry_hits = total_entry_hits + 1
    if not CAPTURE_ALL and not TARGET_SET[frame_count] then return end
    if #calls >= MAX_CALLS then return end
    if pending_marker then return end
    pending_marker = true
    pending_marker_frame = frame_count
end

local function on_exit_tap(offset)
    total_exit_hits = total_exit_hits + 1
    if pending_entry == nil then return end
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
                if offset == FUN_1CABA_ENTRY then
                    -- Note: prefetch may fire this multiple times for the same call.
                    -- We dedup via pending_entry guard.
                    on_entry_tap(offset)
                end
                return data
            end)
        mem:install_read_tap(FUN_1CABA_RTS, FUN_1CABA_RTS + 1, "1caba_exit",
            function(offset, data)
                if offset == FUN_1CABA_RTS then
                    on_exit_tap(offset)
                end
                return data
            end)
        installed = true
    end

    frame_count = frame_count + 1

    if frame_count % 50 == 0 then
        print(string.format("[mame_1caba_trace] fc=%d calls=%d eh=%d xh=%d",
            frame_count, #calls, total_entry_hits, total_exit_hits))
    end
    if frame_count >= LAST_FRAME then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write("{\n")
        out:write(string.format('  "total_calls": %d,\n', #calls))
        out:write(string.format('  "entry_hits": %d,\n', total_entry_hits))
        out:write(string.format('  "exit_hits": %d,\n', total_exit_hits))
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
                '      "bsearch_data": "%s",\n' ..
                '      "pf": "%s"\n' ..
                '    }%s\n',
                c.entry.frame,
                c.entry.tileX, c.entry.tileY,
                c.entry.lvlPtr, c.entry.bsearchPtr, c.entry.maxBound,
                c.entry.struct_pre, c.exit_struct,
                c.entry.colBase, c.entry.bsearchAlt,
                c.entry.bsearch_data,
                c.entry.pf,
                sep
            ))
        end
        out:write('  ]\n')
        out:write("}\n")
        out:close()
        print(string.format("[mame_1caba_trace] entry_hits=%d exit_hits=%d saved %d calls to %s",
            total_entry_hits, total_exit_hits, #calls, OUT_PATH))
        manager.machine:exit()
    end
end)
