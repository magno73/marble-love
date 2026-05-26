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
    0x8177, 0x8179, 0x8188, 0x81A2, 0x81A5,  -- YM init
    0x81A6, 0x81B1, 0x81B8, 0x81C3,
    0x81C6, 0x81C8, 0x81CA, 0x81CC, 0x81CE, 0x81D0, 0x81D2,
    0x81D5, 0x81D7, 0x81DC, 0x81E0, 0x81E2, 0x81E4, 0x81E7,
    0x81E9, 0x81EA, 0x81EC, 0x81EF, 0x81F0, 0x81F3, 0x81F5,
    0x81F8, 0x81FB, 0x81FC, 0x81FD, 0x81FE, 0x81FF, 0x8201, 0x8203,
    0x8205, 0x8208, 0x820A, 0x900A,
    0xE4E5, 0xE4E8, 0xE4EA, 0xE4ED, 0xE4EF, 0xE4F1, 0xE4F2,
    0xE4F4, 0xE4F6, 0xE4F8, 0xE4F9, 0xE4FB, 0xE4FD, 0xE4FF,
    0xE500, 0xE502, 0xE505, 0xE507, 0xE50A, 0xE50B, 0xE50C,
    0xE50E, 0xE510, 0xE512, 0xE514, 0xE516, 0xE518, 0xE51B,
    0xE51D, 0xE51F, 0xE520, 0xE522, 0xE525, 0xE528, 0xE52B,
    0xE52D, 0xE52F, 0xE531, 0xE533, 0xE535, 0xE537, 0xE539,
    0xE53B, 0xE53D, 0xE53F, 0xE541, 0xE542,  -- IRQ handler
    0x824D, 0x829E, 0x8359, 0x84E9, 0x85C0, 0x85D5,  -- init/music dispatch
    0x8722, 0x8724, 0x873D,  -- music data parser
    0x9566, 0x9569, 0x956C,  -- NMI handler
}
local cp_set = {}
for _, pc in ipairs(CHECKPOINTS) do cp_set[pc] = true end

local audiocpu, sound_mem, ports, audio_pc
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
        audio_pc = audiocpu.state["PC"]
        ports = manager.machine.ioport.ports
        table.insert(tap_handles, main_mem:install_read_tap(0xF60000, 0xF60003, "pc_sw", function(o,d,m) return d end))
        table.insert(tap_handles, sound_mem:install_read_tap(0x1820, 0x1820, "pc_coin", function(o,d,m) return d end))

        -- read tap on $8000-$FFFF to catch instruction fetches (= first byte = opcode)
        -- We use opcode fetch as proxy for "PC at this address"
        -- But that's noisy. Better: tap specific checkpoint addresses
        for _, pc in ipairs(CHECKPOINTS) do
            local cp = pc
            table.insert(tap_handles, sound_mem:install_read_tap(cp, cp, "cp_"..pc, function(o, d, m)
                if audio_pc ~= nil and audio_pc.value ~= cp then return d end
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
        ports[":1820"].fields["Coin 1"]:set_value(in_pulse(frame_count + 1, COIN_FRAME) and 1 or 0)
    end
    if ports[":F60000"] and ports[":F60000"].fields["1 Player Start"] then
        ports[":F60000"].fields["1 Player Start"]:set_value(in_pulse(frame_count + 1, START_FRAME) and 1 or 0)
    end
    if frame_count >= TARGET_FRAME then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write('{"hits":{\n')
        local first = true
        local hit_count = 0
        for _, pc in ipairs(CHECKPOINTS) do
            if hits[pc] ~= nil then
                hit_count = hit_count + 1
                local sep = first and "" or ","
                out:write(string.format('%s\n  "0x%04x": {"secs": %d, "attos": "%s", "frame": %d}',
                    sep, pc, hits[pc].secs, tostring(hits[pc].attos), hits[pc].frame))
                first = false
            end
        end
        out:write("\n}}\n")
        out:close()
        print(string.format("[pc_cycles] saved %d/%d hits", hit_count, #CHECKPOINTS))
        manager.machine:exit()
    end
end)
