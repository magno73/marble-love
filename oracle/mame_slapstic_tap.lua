-- mame_slapstic_tap.lua — log accessi alla slapstic window (0x080000-0x087FFF)
-- e bank corrente del chip 137412-103 di Marble Madness, per validare la
-- state-machine replicata in `packages/engine/src/m68k/slapstic-103.ts`.
--
-- Output: /tmp/mame_slapstic_trace.json
--   {
--     "from_frame": ..., "to_frame": ...,
--     "samples": [
--       {"f": N, "pc": "0x...", "op": "R"|"W", "addr": "0x...", "data": "0x...",
--        "size": 1|2, "bank": 0..3},
--       ...
--     ],
--     "bank_per_frame": { "<frame>": <bank_at_end_of_frame>, ... },
--     "totals": { "reads": N, "writes": N, "bank_changes": N }
--   }
--
-- Note:
--  * Il tap installato e' read/write su tutta la window. MAME chiama il
--    callback DOPO che il device slapstic (installato come tap a priorita'
--    pari) ha gia' aggiornato il proprio bank → leggendo il "bank" del
--    device a callback time otteniamo il bank usato per QUESTO accesso.
--    Pero' MAME stampa "current bank N" via logerror DOPO il transition;
--    per affidabilita' leggiamo il device.state["m_current_bank"] post-test.
--  * Se m_current_bank non e' esposto, fallback: ricaviamo il bank dal
--    pattern di accesso analizzandolo offline.
--
-- Env vars:
--   MARBLE_TRACE_FROM — first frame to log (default 12000)
--   MARBLE_TRACE_TO   — last frame to log + exit (default 12005)
--   MARBLE_TRACE_OUT  — output JSON (default /tmp/mame_slapstic_trace.json)

local function getenv(name, fallback)
    local v = os.getenv(name)
    if v == nil or v == "" then return fallback end
    return v
end

local FROM_FR  = tonumber(getenv("MARBLE_TRACE_FROM", "12000"))
local TO_FR    = tonumber(getenv("MARBLE_TRACE_TO", "12005"))
local OUT_PATH = getenv("MARBLE_TRACE_OUT", "/tmp/mame_slapstic_trace.json")
local MAX_SAMPLES = tonumber(getenv("MARBLE_TRACE_MAX_SAMPLES", "100000"))

local cpu = nil
local mem = nil
local cpu_pc = nil
local slapstic_dev = nil

local frame_count = 0
local installed = false

-- Per-sample arrays (column-store)
local s_f, s_pc, s_op, s_addr, s_data, s_mask, s_bank, s_size = {}, {}, {}, {}, {}, {}, {}, {}
local n_samples = 0
local n_reads, n_writes = 0, 0
local bank_per_frame = {}
local last_seen_bank = nil
local bank_changes = 0

-- The slapstic device exposes m_current_bank via the registered state
-- 'm_current_bank' (added by save_item in device_start). We probe it lazily.
local function read_current_bank()
    if slapstic_dev == nil then return -1 end
    -- Try the state interface first.
    local st = slapstic_dev.state
    if st ~= nil then
        local s = st["m_current_bank"]
        if s ~= nil then return s.value end
    end
    return -1
end

local function mask_to_size(m)
    if m == 0xff or m == 0xff00 then return 1 end
    if m == 0xffff then return 2 end
    return 0
end

local function install()
    -- Read tap
    mem:install_read_tap(0x080000, 0x087FFF, "slapstic_read_log", function(o, d, m)
        if frame_count < FROM_FR or frame_count > TO_FR then return end
        n_reads = n_reads + 1
        if n_samples < MAX_SAMPLES then
            n_samples = n_samples + 1
            s_f[n_samples]    = frame_count
            s_pc[n_samples]   = cpu_pc.value
            s_op[n_samples]   = "R"
            s_addr[n_samples] = o
            s_data[n_samples] = d
            s_mask[n_samples] = m
            s_size[n_samples] = mask_to_size(m)
            -- Read bank AFTER MAME's own slapstic tap ran (we are at the same
            -- priority bucket; MAME calls taps in install order, so the device
            -- got the access first → its state reflects post-this-access bank).
            s_bank[n_samples] = read_current_bank()
        end
        local cb = read_current_bank()
        if last_seen_bank ~= nil and cb ~= last_seen_bank then bank_changes = bank_changes + 1 end
        last_seen_bank = cb
    end)
    -- Write tap (writes ignored as data on slapstic ROM, but trigger FSM)
    mem:install_write_tap(0x080000, 0x087FFF, "slapstic_write_log", function(o, d, m)
        if frame_count < FROM_FR or frame_count > TO_FR then return end
        n_writes = n_writes + 1
        if n_samples < MAX_SAMPLES then
            n_samples = n_samples + 1
            s_f[n_samples]    = frame_count
            s_pc[n_samples]   = cpu_pc.value
            s_op[n_samples]   = "W"
            s_addr[n_samples] = o
            s_data[n_samples] = d
            s_mask[n_samples] = m
            s_size[n_samples] = mask_to_size(m)
            s_bank[n_samples] = read_current_bank()
        end
        local cb = read_current_bank()
        if last_seen_bank ~= nil and cb ~= last_seen_bank then bank_changes = bank_changes + 1 end
        last_seen_bank = cb
    end)
end

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
        cpu_pc = cpu.state["PC"]
        -- The slapstic device tag for Atari System 1 marble is ":slapstic" per
        -- atarisy1.cpp:228 (slapstic_103). Try a few candidates.
        for _, tag in ipairs({":slapstic", ":maincpu:slapstic", ":slapstic_103"}) do
            if manager.machine.devices[tag] ~= nil then
                slapstic_dev = manager.machine.devices[tag]
                print(string.format("[slapstic_tap] using device tag %s", tag))
                break
            end
        end
        if slapstic_dev == nil then
            print("[slapstic_tap] WARN: slapstic device not found at expected tags")
        end
    end

    frame_count = frame_count + 1

    if frame_count == FROM_FR - 1 and not installed then
        install()
        installed = true
        print(string.format("[slapstic_tap] tap installed frames=%d..%d", FROM_FR, TO_FR))
        last_seen_bank = read_current_bank()
        print(string.format("[slapstic_tap] initial bank at fc=%d: %d", frame_count, last_seen_bank))
    end

    if frame_count >= FROM_FR and frame_count <= TO_FR then
        bank_per_frame[frame_count] = read_current_bank()
    end

    if frame_count > TO_FR then
        local f = assert(io.open(OUT_PATH, "w"))
        f:write("{\n")
        f:write(string.format('  "from_frame": %d,\n', FROM_FR))
        f:write(string.format('  "to_frame": %d,\n', TO_FR))
        f:write(string.format('  "totals": {"reads": %d, "writes": %d, "samples": %d, "bank_changes": %d},\n',
            n_reads, n_writes, n_samples, bank_changes))
        f:write('  "bank_per_frame": {')
        local first = true
        for fr, bk in pairs(bank_per_frame) do
            if not first then f:write(",") end
            f:write(string.format('"%d":%d', fr, bk))
            first = false
        end
        f:write("},\n")
        f:write('  "samples": [\n')
        for i = 1, n_samples do
            local sep = (i < n_samples) and "," or ""
            f:write(string.format(
                '    {"f":%d,"pc":"0x%06x","op":"%s","addr":"0x%06x","data":"0x%08x","mask":"0x%08x","size":%d,"bank":%d}%s\n',
                s_f[i], s_pc[i], s_op[i], s_addr[i], s_data[i], s_mask[i], s_size[i], s_bank[i], sep
            ))
        end
        f:write("  ]\n")
        f:write("}\n")
        f:close()
        print(string.format("[slapstic_tap] DONE reads=%d writes=%d samples=%d bank_changes=%d -> %s",
            n_reads, n_writes, n_samples, bank_changes, OUT_PATH))
        manager.machine:exit()
    end
end)
