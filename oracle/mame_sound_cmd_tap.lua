-- mame_sound_cmd_tap.lua - capture 68K -> 6502 commands through a $FE0001 write tap.
--
-- Output JSON: { frame: int, cmds: [{frame: N, byte: B}, ...] }
-- Allows the TS probe-sound-diff to replay exactly the same sequence.
-- Those commands are equivalent to submitCommand calls emitted by the MAME main CPU.
--
-- Env:
--   MARBLE_SOUND_CMD_TARGET_FRAME - capture through this frame (default 600)
--   MARBLE_SOUND_CMD_OUT          — output file (default /tmp/mame_sound_cmds.json)
--
-- Usage:
--   mame marble -rompath roms -nothrottle -skip_gameinfo -video none -sound none \
--     -nvram_directory /tmp/snd_nv -cfg_directory /tmp/snd_cfg -nonvram_save \
--     -autoboot_script oracle/mame_sound_cmd_tap.lua

local TARGET_FRAME = tonumber(os.getenv("MARBLE_SOUND_CMD_TARGET_FRAME") or "600")
local OUT_PATH = os.getenv("MARBLE_SOUND_CMD_OUT") or "/tmp/mame_sound_cmds.json"

local maincpu = nil
local main_mem = nil
local cmds = {}
local frame_count = 0
local tap_installed = false

local function install_tap()
    if tap_installed then return end
    maincpu = manager.machine.devices[":maincpu"]
    if maincpu == nil then return end
    main_mem = maincpu.spaces["program"]
    if main_mem == nil or main_mem.install_write_tap == nil then
        print("[sound_cmd_tap] WARN: no install_write_tap on maincpu program space")
        return
    end
    -- $FE0001 = m_soundlatch.write (atarisy1.cpp main_map). 8-bit lane (odd
    -- byte: bus 68010 high byte → low byte on 8-bit device).
    -- Bus 16-bit del 68010: $FE0001 (odd byte) e' accessibile via $FE0000
    -- with low mask. Filter: keep only writes with mask & 0xff != 0 (= low
    -- byte = sound latch). MAME passes the full byte in `d`; the effective byte
    -- e' (d & 0xff).
    main_mem:install_write_tap(0xFE0000, 0xFE0001, "sound_cmd", function(o, d, m)
        if (m & 0xff) ~= 0 then
            table.insert(cmds, { frame = frame_count, byte = (d & 0xff) })
        end
    end)
    print("[sound_cmd_tap] tap installed on $FE0001")
    tap_installed = true
end

emu.register_frame_done(function()
    install_tap()
    frame_count = frame_count + 1
    if frame_count >= TARGET_FRAME then
        -- Dump JSON
        local out = assert(io.open(OUT_PATH, "w"))
        out:write("{\n")
        out:write(string.format('  "frame": %d,\n', frame_count))
        out:write(string.format('  "count": %d,\n', #cmds))
        out:write('  "cmds": [\n')
        for i, c in ipairs(cmds) do
            local sep = (i < #cmds) and "," or ""
            out:write(string.format('    {"frame": %d, "byte": %d}%s\n', c.frame, c.byte, sep))
        end
        out:write("  ]\n")
        out:write("}\n")
        out:close()
        print(string.format("[sound_cmd_tap] dumped %d cmds across %d frames to %s",
            #cmds, frame_count, OUT_PATH))
        manager.machine:exit()
    end
end)
