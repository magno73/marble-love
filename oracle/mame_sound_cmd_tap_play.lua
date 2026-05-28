-- mame_sound_cmd_tap_play.lua - capture 68K -> 6502 cmd with scripted coin+start.
--
-- Difference from mame_sound_cmd_tap.lua: this tap injects coin+start after
-- boot, so main 68K exits the attract loop and starts emitting real commands.
-- to the 6502 through soundlatch $FE0001. The pure attract loop emits no commands.
-- Verified with wide tap $FE0000-$FEFFFF over 600 attract frames = 0 writes.
--
-- Scripted sequence (default, override via env): follows the pattern from
-- oracle/mame_playable_input_capture.lua, which works deterministically:
--   f1200..1214 → Coin 1 pressed (port :1820 bit 0 active low)
--   f1500..1514 → 1 Player Start pressed (port :F60000)
--   capture continues until MARBLE_SOUND_CMD_TARGET_FRAME (default 2400)
--
-- Output JSON: { frame, count, cmds: [{frame, byte}, ...] }
--
-- Env:
--   MARBLE_SOUND_CMD_TARGET_FRAME - total frames (default 2400)
--   MARBLE_SOUND_CMD_OUT          — output file (default /tmp/mame_sound_cmds.json)
--   MARBLE_SOUND_COIN_FRAME       - first coin pulse frame (default 1200)
--   MARBLE_SOUND_START_FRAME      - first start pulse frame (default 1500)
--
-- Usage:
--   mame marble -rompath roms -nothrottle -skip_gameinfo -video none -sound none \
--     -nvram_directory /tmp/snd_nv -cfg_directory /tmp/snd_cfg -nonvram_save \
--     -autoboot_script oracle/mame_sound_cmd_tap_play.lua -autoboot_delay 0

local TARGET_FRAME = tonumber(os.getenv("MARBLE_SOUND_CMD_TARGET_FRAME") or "2400")
local OUT_PATH = os.getenv("MARBLE_SOUND_CMD_OUT") or "/tmp/mame_sound_cmds.json"
local COIN_FRAME = tonumber(os.getenv("MARBLE_SOUND_COIN_FRAME") or "1200")
local START_FRAME = tonumber(os.getenv("MARBLE_SOUND_START_FRAME") or "1500")
local PULSE_LEN = 15

local maincpu = nil
local main_mem = nil
local ports = nil
local cmds = {}
local frame_count = 0
local tap_installed = false

local function in_pulse(frame, start)
    return frame >= start and frame < (start + PULSE_LEN)
end

local function install_tap()
    if tap_installed then return end
    maincpu = manager.machine.devices[":maincpu"]
    if maincpu == nil then return end
    main_mem = maincpu.spaces["program"]
    if main_mem == nil or main_mem.install_write_tap == nil then
        print("[sound_cmd_tap_play] WARN: no install_write_tap on maincpu program space")
        return
    end
    main_mem:install_write_tap(0xFE0000, 0xFE0001, "sound_cmd_play", function(o, d, m)
        if (m & 0xff) ~= 0 then
            table.insert(cmds, { frame = frame_count, byte = (d & 0xff) })
        end
    end)
    ports = manager.machine.ioport.ports
    print(string.format("[sound_cmd_tap_play] tap installed on $FE0001; coin=f%d start=f%d target=f%d",
        COIN_FRAME, START_FRAME, TARGET_FRAME))
    tap_installed = true
end

local function apply_input(frame)
    if ports == nil then return end
    local coin_pressed = in_pulse(frame, COIN_FRAME)
    local start_pressed = in_pulse(frame, START_FRAME)

    -- Coin 1 (port :1820) and 1 Player Start (port :F60000) are both
    -- IP_ACTIVE_LOW in atarisy1.cpp: set_value(1) = "field active/pressed",
    -- MAME inverts internally for ACTIVE_LOW.
    local coin_port = ports[":1820"]
    if coin_port and coin_port.fields["Coin 1"] then
        coin_port.fields["Coin 1"]:set_value(coin_pressed and 1 or 0)
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
    out:write(string.format('  "count": %d,\n', #cmds))
    out:write('  "cmds": [\n')
    for i, c in ipairs(cmds) do
        local sep = (i < #cmds) and "," or ""
        out:write(string.format('    {"frame": %d, "byte": %d}%s\n', c.frame, c.byte, sep))
    end
    out:write("  ]\n")
    out:write("}\n")
    out:close()
    print(string.format("[sound_cmd_tap_play] dumped %d cmds across %d frames to %s",
        #cmds, frame_count, OUT_PATH))
end

emu.register_frame_done(function()
    install_tap()
    frame_count = frame_count + 1
    apply_input(frame_count + 1)
    if frame_count >= TARGET_FRAME then
        dump_json()
        manager.machine:exit()
    end
end)
