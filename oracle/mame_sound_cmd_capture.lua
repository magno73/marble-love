-- mame_sound_cmd_capture.lua — capture cmd 68K → 6502 mentre la main 68K e' in
-- gameplay reale (coin+start scripted). Replica il pattern di install + input
-- injection di oracle/mame_playable_input_capture.lua (che e' verificato
-- generare scenari di gameplay), aggiunge un install_write_tap su $FE0001 per
-- registrare i sound cmd.
--
-- Output JSON: { frame, count, cmds: [{frame, byte}, ...] }
--
-- Env:
--   MARBLE_SOUND_CMD_TARGET_FRAME — frame totali (default 3000)
--   MARBLE_SOUND_CMD_OUT          — output file (default /tmp/mame_sound_cmds.json)
--   MARBLE_SOUND_COIN_FRAME       — primo frame coin pulse (default 1200)
--   MARBLE_SOUND_START_FRAME      — primo frame start pulse (default 1500)
--
-- Usage:
--   mame marble -rompath roms -nothrottle -skip_gameinfo -video none \
--     -nvram_directory /tmp/snd_nv -cfg_directory /tmp/snd_cfg -nonvram_save \
--     -autoboot_script oracle/mame_sound_cmd_capture.lua -autoboot_delay 0

local TARGET_FRAME = tonumber(os.getenv("MARBLE_SOUND_CMD_TARGET_FRAME") or "3000")
local OUT_PATH = os.getenv("MARBLE_SOUND_CMD_OUT") or "/tmp/mame_sound_cmds.json"
local COIN_FRAME = tonumber(os.getenv("MARBLE_SOUND_COIN_FRAME") or "1200")
local START_FRAME = tonumber(os.getenv("MARBLE_SOUND_START_FRAME") or "1500")
local PULSE_LEN = 15

local maincpu, main_mem
local audiocpu, sound_mem
local ports
local frame_count = 0
local installed = false
local cmds = {}
local sound_coin_reads = 0
local main_switch_reads = 0
-- I tap handle restituiti da install_*_tap MUSCONO essere mantenuti in vita:
-- senza riferimento Lua, il GC li libera e il tap smette di firare (verificato
-- empiricamente). Mame_playable_input_capture.lua applica lo stesso pattern.
local tap_handles = {}

local function in_pulse(frame, start)
    return frame >= start and frame < (start + PULSE_LEN)
end

local function install_taps()
    -- Replica esatta del pattern playable_input_capture: install_read_tap su
    -- main CPU per gli input ports (questi taps forzano MAME a non bypassare
    -- la bus-decode anche per accessi frequent come $1820 in attract loop).
    maincpu = manager.machine.devices[":maincpu"]
    main_mem = maincpu.spaces["program"]
    for _, tag in ipairs({":audiocpu", ":soundcpu"}) do
        if manager.machine.devices[tag] then
            audiocpu = manager.machine.devices[tag]
            break
        end
    end
    sound_mem = audiocpu.spaces["program"]
    ports = manager.machine.ioport.ports

    -- Read taps su main CPU input ports (osservativi, ritornano data invariato)
    table.insert(tap_handles,
        main_mem:install_read_tap(0xF20000, 0xF20007, "snd_cap_trackball", function(o, d, m) return d end))
    table.insert(tap_handles,
        main_mem:install_read_tap(0xF60000, 0xF60003, "snd_cap_switches", function(o, d, m)
            main_switch_reads = main_switch_reads + 1
            return d
        end))
    table.insert(tap_handles,
        main_mem:install_read_tap(0xFC0000, 0xFC0001, "snd_cap_response", function(o, d, m) return d end))
    table.insert(tap_handles,
        main_mem:install_read_tap(0xFE0000, 0xFE0001, "snd_cap_cmd_r", function(o, d, m) return d end))

    -- Sound CPU coin port read tap.
    table.insert(tap_handles,
        sound_mem:install_read_tap(0x1820, 0x1820, "snd_cap_coin", function(o, d, m)
            sound_coin_reads = sound_coin_reads + 1
            return d
        end))

    -- Il tap critico: $FE0001 write da main = soundlatch cmd al sound 6502.
    -- Bus 16-bit del 68010: write a $FE0000 con mask & 0xff != 0 colpisce
    -- l'odd byte ($FE0001) che e' il vero soundlatch.
    table.insert(tap_handles,
        main_mem:install_write_tap(0xFE0000, 0xFE0001, "snd_cap_cmd_w", function(o, d, m)
            if (m & 0xff) ~= 0 then
                table.insert(cmds, { frame = frame_count, byte = (d & 0xff) })
            end
            return d
        end))

    print(string.format("[snd_cmd_capture] taps installed; coin=f%d start=f%d target=f%d",
        COIN_FRAME, START_FRAME, TARGET_FRAME))
end

local function apply_input(frame)
    if ports == nil then return end
    local coin_pressed = in_pulse(frame, COIN_FRAME)
    local start_pressed = in_pulse(frame, START_FRAME)

    -- Polarita' verificata empiricamente in mame_playable_input_capture.lua:
    -- Coin 1 (port :1820, IP_ACTIVE_LOW): set_value(0) = pressed, 1 = released
    -- 1 Player Start (port :F60000, IP_ACTIVE_LOW): set_value(1) = pressed, 0 = released
    local coin_port = ports[":1820"]
    if coin_port and coin_port.fields["Coin 1"] then
        coin_port.fields["Coin 1"]:set_value(coin_pressed and 0 or 1)
    end
    local start_port = ports[":F60000"]
    if start_port and start_port.fields["1 Player Start"] then
        start_port.fields["1 Player Start"]:set_value(start_pressed and 1 or 0)
    end
end

local function dump_json()
    local out = assert(io.open(OUT_PATH, "w"))
    out:write("{\n")
    out:write(string.format('  "frame": %d,\n', frame_count))
    out:write(string.format('  "coinFrame": %d,\n', COIN_FRAME))
    out:write(string.format('  "startFrame": %d,\n', START_FRAME))
    out:write(string.format('  "soundCoinReads": %d,\n', sound_coin_reads))
    out:write(string.format('  "mainSwitchReads": %d,\n', main_switch_reads))
    out:write(string.format('  "count": %d,\n', #cmds))
    out:write('  "cmds": [\n')
    for i, c in ipairs(cmds) do
        local sep = (i < #cmds) and "," or ""
        out:write(string.format('    {"frame": %d, "byte": %d}%s\n', c.frame, c.byte, sep))
    end
    out:write("  ]\n")
    out:write("}\n")
    out:close()
    print(string.format("[snd_cmd_capture] dumped %d cmds across %d frames to %s (sound_coin_reads=%d, main_switch_reads=%d)",
        #cmds, frame_count, OUT_PATH, sound_coin_reads, main_switch_reads))
end

emu.register_frame_done(function()
    if not installed then
        install_taps()
        installed = true
    end
    frame_count = frame_count + 1
    apply_input(frame_count + 1)

    if frame_count % 500 == 0 then
        print(string.format("[snd_cmd_capture] f%d cmds=%d snd_coin_reads=%d main_sw_reads=%d",
            frame_count, #cmds, sound_coin_reads, main_switch_reads))
    end

    if frame_count >= TARGET_FRAME then
        dump_json()
        manager.machine:exit()
    end
end)
