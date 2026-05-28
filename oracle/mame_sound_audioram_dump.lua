-- mame_sound_audioram_dump.lua — dump RAM del sound 6502 a frame snapshot
-- multiple frames, with the same coin/start flow + cmd tap as mame_sound_cmd_capture.
-- Permette diff TS vs MAME audioRam frame-by-frame per drill A1.
--
-- Output JSON: { dumps: [{frame: N, audioRam: "hex..."}, ...], ymRegs: hex, pokeyRegs: hex }
--
-- Env:
--   MARBLE_SND_DUMP_FRAMES    CSV frame snapshot (default "245,300,400,500,600,800,1000,1500,2000,3000")
--   MARBLE_SND_DUMP_OUT       output JSON path (default /tmp/mame_audioram_dump.json)
--   MARBLE_SOUND_COIN_FRAME   primo frame coin (default 1200) — must match capture
--   MARBLE_SOUND_START_FRAME  primo frame start (default 1500) — must match capture

local FRAMES_RAW = os.getenv("MARBLE_SND_DUMP_FRAMES") or "245,300,400,500,600,800,1000,1500,2000,3000"
local OUT_PATH = os.getenv("MARBLE_SND_DUMP_OUT") or "/tmp/mame_audioram_dump.json"
local COIN_FRAME = tonumber(os.getenv("MARBLE_SOUND_COIN_FRAME") or "1200")
local START_FRAME = tonumber(os.getenv("MARBLE_SOUND_START_FRAME") or "1500")
local PULSE_LEN = 15

local frame_set = {}
local max_frame = 0
for tok in string.gmatch(FRAMES_RAW, "([^,]+)") do
    local f = tonumber(tok)
    if f then
        frame_set[f] = true
        if f > max_frame then max_frame = f end
    end
end
local TARGET_FRAME = max_frame + 1

local maincpu, main_mem
local audiocpu, sound_mem
local ports
local frame_count = 0
local installed = false
local dumps = {}
local tap_handles = {}

local function in_pulse(frame, start)
    return frame >= start and frame < (start + PULSE_LEN)
end

local function install_taps()
    maincpu = manager.machine.devices[":maincpu"]
    main_mem = maincpu.spaces["program"]
    for _, tag in ipairs({":audiocpu", ":soundcpu"}) do
        if manager.machine.devices[tag] then audiocpu = manager.machine.devices[tag]; break end
    end
    sound_mem = audiocpu.spaces["program"]
    ports = manager.machine.ioport.ports

    -- Identical to mame_sound_cmd_capture.lua because different setup changes
    -- la timing del 6502 e l'audioRam.
    table.insert(tap_handles,
        main_mem:install_read_tap(0xF20000, 0xF20007, "dump_trackball", function(o, d, m) return d end))
    table.insert(tap_handles,
        main_mem:install_read_tap(0xF60000, 0xF60003, "dump_switches", function(o, d, m) return d end))
    table.insert(tap_handles,
        main_mem:install_read_tap(0xFC0000, 0xFC0001, "dump_response", function(o, d, m) return d end))
    table.insert(tap_handles,
        main_mem:install_read_tap(0xFE0000, 0xFE0001, "dump_cmd_r", function(o, d, m) return d end))
    table.insert(tap_handles,
        sound_mem:install_read_tap(0x1820, 0x1820, "dump_coin", function(o, d, m) return d end))
    print("[snd_audioram_dump] taps installed")
end

local function apply_input(frame)
    local coin_pressed = in_pulse(frame, COIN_FRAME)
    local start_pressed = in_pulse(frame, START_FRAME)
    local coin_port = ports[":1820"]
    if coin_port and coin_port.fields["Coin 1"] then
        coin_port.fields["Coin 1"]:set_value(coin_pressed and 1 or 0)
    end
    local start_port = ports[":F60000"]
    if start_port and start_port.fields["1 Player Start"] then
        start_port.fields["1 Player Start"]:set_value(start_pressed and 1 or 0)
    end
end

local function hex_region_sound(addr, size)
    local parts = {}
    for i = 0, size - 1 do
        parts[i + 1] = string.format("%02x", sound_mem:read_u8(addr + i))
    end
    return table.concat(parts)
end

local function dump_frame()
    -- RAM sound CPU $0000-$0FFF (4KB), ym2151 + pokey reg state via YM/POKEY device
    -- We read $0000-$0FFF via the sound_mem space.
    local audio_ram = hex_region_sound(0x0000, 0x1000)
    table.insert(dumps, { frame = frame_count, audioRam = audio_ram })
    print(string.format("[snd_audioram_dump] dumped f%d (%d bytes)", frame_count, 0x1000))
end

emu.register_frame_done(function()
    if not installed then
        install_taps()
        installed = true
    end
    frame_count = frame_count + 1
    apply_input(frame_count + 1)
    if frame_set[frame_count] then
        dump_frame()
    end
    if frame_count >= TARGET_FRAME then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write("{\n")
        out:write(string.format('  "coinFrame": %d,\n', COIN_FRAME))
        out:write(string.format('  "startFrame": %d,\n', START_FRAME))
        out:write('  "dumps": [\n')
        for i, d in ipairs(dumps) do
            local sep = (i < #dumps) and "," or ""
            out:write(string.format('    {"frame": %d, "audioRam": "%s"}%s\n',
                d.frame, d.audioRam, sep))
        end
        out:write("  ]\n")
        out:write("}\n")
        out:close()
        print(string.format("[snd_audioram_dump] saved %d dumps to %s", #dumps, OUT_PATH))
        manager.machine:exit()
    end
end)
