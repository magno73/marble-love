-- mame_sound_pc_cycles.lua — log cycle count del sound 6502 a specifici
-- checkpoint PC. Permette confronto cycle-exact TS vs MAME.
--
-- Checkpoint: lista di PC + cycle count alla prima volta che ognuno viene
-- raggiunto. Confronto col TS via probe-cycles-checkpoint.ts.
--
-- TODO: cycle count via manager.machine.time × clock ha precision issues
-- (Lua int overflow su 1e18). Per drill A1 cycle-exact serve approccio
-- diverso: contare istruzioni (= read fetches ROM) o usare attoseconds
-- come grandezza relativa fra checkpoint.

local OUT_PATH = os.getenv("MARBLE_PC_CYC_OUT") or "/tmp/mame_pc_cycles.json"
local TARGET_FRAME = tonumber(os.getenv("MARBLE_PC_CYC_TARGET") or "500")
local COIN_FRAME = 1200
local START_FRAME = 1500
local PULSE_LEN = 15

-- Checkpoint PCs interessanti del boot path
local CHECKPOINTS = {
    0x8002, 0x8016, 0x802C, 0x808F, 0x80A3, 0x80A6, 0x80AD, 0x80AE,
    0x80B5, 0x80C3, 0x80C8, 0x80E7, 0x80EA, 0x80EE,
    0x8177, 0x8179, 0x81A2, 0x81A5,  -- YM init
    0x81A6, 0x81B1, 0x81B8, 0x81C3, 0x81FE,  -- IRQ handler
    0x8359, 0x84E9, 0x85C0, 0x85D5,  -- music dispatch
    0x8722, 0x8724, 0x873D,  -- music data parser
    0x9566, 0x9569, 0x956C,  -- NMI handler
}
local cp_set = {}
for _, pc in ipairs(CHECKPOINTS) do cp_set[pc] = true end

local audiocpu, sound_mem, ports
local frame_count = 0
local installed = false
local tap_handles = {}
local hits = {}  -- {pc: { cycle_count, frame, n_hits }}
local function in_pulse(f, s) return f >= s and f < s + PULSE_LEN end

emu.register_frame_done(function()
    if not installed then
        local main_mem = manager.machine.devices[":maincpu"].spaces["program"]
        for _, t in ipairs({":audiocpu", ":soundcpu"}) do
            if manager.machine.devices[t] then audiocpu = manager.machine.devices[t]; break end
        end
        sound_mem = audiocpu.spaces["program"]
        ports = manager.machine.ioport.ports
        table.insert(tap_handles, main_mem:install_read_tap(0xF60000, 0xF60003, "pc_sw", function(o,d,m) return d end))
        table.insert(tap_handles, sound_mem:install_read_tap(0x1820, 0x1820, "pc_coin", function(o,d,m) return d end))

        -- read tap on $8000-$FFFF to catch instruction fetches (= first byte = opcode)
        -- We use opcode fetch as proxy for "PC at this address"
        -- But that's noisy. Better: tap specific checkpoint addresses
        for _, pc in ipairs(CHECKPOINTS) do
            local hi = (pc >> 8) & 0xFF
            local lo = pc & 0xFF
            local cp = pc
            table.insert(tap_handles, sound_mem:install_read_tap(cp, cp, "cp_"..pc, function(o, d, m)
                if hits[cp] == nil then
                    -- Save secs + attoseconds separately, compute cycles in Python
                    -- to avoid Lua 1e18 precision issues.
                    local t = manager.machine.time
                    hits[cp] = { secs = t.seconds, attos = t.attoseconds, frame = frame_count }
                end
                return d
            end))
        end
        installed = true
        print(string.format("[pc_cycles] installed %d checkpoints", #CHECKPOINTS))
    end
    frame_count = frame_count + 1
    if ports[":1820"] and ports[":1820"].fields["Coin 1"] then
        ports[":1820"].fields["Coin 1"]:set_value(in_pulse(frame_count + 1, COIN_FRAME) and 0 or 1)
    end
    if ports[":F60000"] and ports[":F60000"].fields["1 Player Start"] then
        ports[":F60000"].fields["1 Player Start"]:set_value(in_pulse(frame_count + 1, START_FRAME) and 1 or 0)
    end
    if frame_count >= TARGET_FRAME then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write('{"hits":{\n')
        local first = true
        for _, pc in ipairs(CHECKPOINTS) do
            if hits[pc] ~= nil then
                local sep = first and "" or ","
                out:write(string.format('%s\n  "0x%04x": {"secs": %d, "attos": "%s", "frame": %d}',
                    sep, pc, hits[pc].secs, tostring(hits[pc].attos), hits[pc].frame))
                first = false
            end
        end
        out:write("\n}}\n")
        out:close()
        print(string.format("[pc_cycles] saved %d hits", #CHECKPOINTS))
        manager.machine:exit()
    end
end)
