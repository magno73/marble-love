-- mame_1caba_capture.lua — capture INPUT/OUTPUT for every call to FUN_1CABA.
-- Strategy:
--   * tap callbacks: lightweight only (regs + small reads + 32B struct).
--   * heavy snapshot (colBase, bsearchAlt, playfield): taken ONCE at fc=170
--     in frame_done (before first call at f173), since these don't change
--     during the firing window and FUN_1CABA never writes them.

local MAX_CALLS = tonumber(os.getenv("MARBLE_MAX") or "70")
local STOP_FRAME = tonumber(os.getenv("MARBLE_STOP") or "250")
local SNAP_FRAME = tonumber(os.getenv("MARBLE_SNAP") or "170")
local OUT_PATH = os.getenv("MARBLE_OUT") or "/tmp/mame_1caba_capture.json"

local cpu = nil
local mem = nil
local cpu_pc = nil
local frame_count = 0
local installed = false
local calls = {}
local pending = nil
local total_entries = 0
local total_exits = 0
local global_snapshot = nil


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

local function on_entry(o)
    if o ~= 0x1CABA then return end
    if cpu_pc.value ~= 0x1CABA then return end
    total_entries = total_entries + 1
    if #calls >= MAX_CALLS then return end
    if pending ~= nil then return end
    local d, a = read_regs()
    pending = {
        frame = frame_count,
        d = d,
        a = a,
        tileX = mem:read_u16(0x400696),
        tileY = mem:read_u16(0x400698),
        lvlPtr = mem:read_u32(0x400474),
        bsearchPtr = mem:read_u32(0x40065A),
        struct_pre = snapshot_struct(0x401C28),
    }
    -- Snapshot per-call critical workRam regions for the FIRST call and a
    -- sampling of subsequent "change" calls (where struct mutates).
    -- Index pattern: 0, every-3rd to avoid overhead. ~20 snapshots.
    -- Snapshot per-call critical workRam regions for the FIRST call only —
    -- subsequent calls have struct_pre = workRam[1c28..] state which we
    -- preserve from prior call's struct_post. The global snapshot at
    -- snap_frame has these regions zero (= stale), but for "no-op" calls
    -- (struct_pre == struct_post) the replica produces no changes and parity
    -- holds vacuously.
    if #calls == 0 then
        pending.colBase = snapshot_bytes(0x400478, 0x200)
        pending.bsearchAlt = snapshot_bytes(0x40076E, 0x200)
    end
end

local function on_exit(o)
    if o ~= 0x1CC5E then return end
    if cpu_pc.value ~= 0x1CC5E then return end
    total_exits = total_exits + 1
    if pending == nil then return end
    local struct_post = snapshot_struct(0x401C28)
    table.insert(calls, { entry = pending, struct_post = struct_post })
    pending = nil
end

local function bytes_to_hex(t)
    local parts = {}
    for i, b in ipairs(t) do
        parts[i] = string.format("%02x", b)
    end
    return table.concat(parts)
end

local function words_to_hex(t)
    local parts = {}
    for i, w in ipairs(t) do
        parts[i] = string.format("%04x", w)
    end
    return table.concat(parts)
end

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
        cpu_pc = cpu.state["PC"]
    end
    if not installed then
        mem:install_read_tap(0x1CABA, 0x1CABB, "1caba_entry", function(o, d)
            on_entry(o)
            return d
        end)
        mem:install_read_tap(0x1CC5E, 0x1CC5F, "1caba_exit", function(o, d)
            on_exit(o)
            return d
        end)
        installed = true
        print(string.format("[capture] installed taps max_calls=%d stop_frame=%d snap_frame=%d",
            MAX_CALLS, STOP_FRAME, SNAP_FRAME))
    end
    frame_count = frame_count + 1
    if frame_count == SNAP_FRAME and global_snapshot == nil then
        print(string.format("[capture] taking global snapshot at fc=%d", frame_count))
        global_snapshot = {
            workRam = snapshot_bytes(0x400000, 0x2000),
            playfieldRam = snapshot_bytes(0xA00000, 0x2000),
            spriteRam = snapshot_bytes(0x800000, 0x1000),
        }
        -- Re-install taps (snapshot may have flushed translation cache)
        mem:install_read_tap(0x1CABA, 0x1CABB, "1caba_entry_v2", function(o, d)
            on_entry(o)
            return d
        end)
        mem:install_read_tap(0x1CC5E, 0x1CC5F, "1caba_exit_v2", function(o, d)
            on_exit(o)
            return d
        end)
        print(string.format("[capture] snapshot done, taps re-installed"))
    end
    if frame_count % 50 == 0 then
        print(string.format("[capture] fc=%d e=%d x=%d calls=%d", frame_count, total_entries, total_exits, #calls))
    end
    if frame_count >= STOP_FRAME or #calls >= MAX_CALLS then
        local f = assert(io.open(OUT_PATH, "w"))
        f:write("{\n")
        f:write(string.format('  "stop_frame": %d,\n', frame_count))
        f:write(string.format('  "snap_frame": %d,\n', SNAP_FRAME))
        f:write(string.format('  "total_entries": %d,\n', total_entries))
        f:write(string.format('  "total_exits": %d,\n', total_exits))
        f:write(string.format('  "total_calls": %d,\n', #calls))
        if global_snapshot then
            f:write(string.format('  "workRam": "%s",\n', bytes_to_hex(global_snapshot.workRam)))
            f:write(string.format('  "playfieldRam": "%s",\n', bytes_to_hex(global_snapshot.playfieldRam)))
            f:write(string.format('  "spriteRam": "%s",\n', bytes_to_hex(global_snapshot.spriteRam)))
        end
        f:write('  "calls": [\n')
        for i, c in ipairs(calls) do
            local sep = (i < #calls) and "," or ""
            local d_str = {}
            local a_str = {}
            for j = 1, 8 do
                d_str[j] = string.format('"0x%08x"', c.entry.d[j])
                a_str[j] = string.format('"0x%08x"', c.entry.a[j])
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
                '      "bsearchAlt": "%s"\n' ..
                '    }%s\n',
                c.entry.frame,
                table.concat(d_str, ","),
                table.concat(a_str, ","),
                c.entry.tileX, c.entry.tileY,
                c.entry.lvlPtr, c.entry.bsearchPtr,
                words_to_hex(c.entry.struct_pre),
                words_to_hex(c.struct_post),
                c.entry.colBase and bytes_to_hex(c.entry.colBase) or "",
                c.entry.bsearchAlt and bytes_to_hex(c.entry.bsearchAlt) or "",
                sep
            ))
        end
        f:write('  ]\n}\n')
        f:close()
        print(string.format("[capture] DONE fc=%d e=%d x=%d calls=%d -> %s",
            frame_count, total_entries, total_exits, #calls, OUT_PATH))
        manager.machine:exit()
    end
end)
