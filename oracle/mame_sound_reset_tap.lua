-- mame_sound_reset_tap.lua — capture writes to $860001 from main (bankselect_w).
-- Bit 7 = sound CPU reset (1 = run/release, 0 = hold). Aim: identify the
-- exact frame where MAME moves the sound 6502 from hold to run.
--
-- Output JSON: { events: [{frame, byte, soundRun: bool}], firstReleaseFrame: N }
--
-- Env:
--   MARBLE_SOUND_RESET_TARGET_FRAME — capture up to (default 600)
--   MARBLE_SOUND_RESET_OUT          — output (default /tmp/mame_sound_reset.json)

local TARGET_FRAME = tonumber(os.getenv("MARBLE_SOUND_RESET_TARGET_FRAME") or "600")
local OUT_PATH = os.getenv("MARBLE_SOUND_RESET_OUT") or "/tmp/mame_sound_reset.json"

local maincpu = nil
local main_mem = nil
local events = {}
local first_release_frame = -1
local frame_count = 0
local tap_installed = false

local function install_tap()
    if tap_installed then return end
    maincpu = manager.machine.devices[":maincpu"]
    if maincpu == nil then return end
    main_mem = maincpu.spaces["program"]
    if main_mem == nil or main_mem.install_write_tap == nil then return end
    -- $860001 = bankselect_w. 16-bit bus, low byte; uses range $860000-$860001
    -- with mask filter.
    main_mem:install_write_tap(0x860000, 0x860001, "sound_reset_ctrl", function(o, d, m)
        if (m & 0xff) ~= 0 then
            local byte = d & 0xff
            local soundRun = ((byte & 0x80) ~= 0)
            table.insert(events, { frame = frame_count, byte = byte, soundRun = soundRun })
            if soundRun and first_release_frame < 0 then
                first_release_frame = frame_count
            end
        end
    end)
    print("[sound_reset_tap] tap installed on $860001")
    tap_installed = true
end

emu.register_frame_done(function()
    install_tap()
    frame_count = frame_count + 1
    if frame_count >= TARGET_FRAME then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write("{\n")
        out:write(string.format('  "targetFrame": %d,\n', frame_count))
        out:write(string.format('  "count": %d,\n', #events))
        out:write(string.format('  "firstReleaseFrame": %d,\n', first_release_frame))
        out:write('  "events": [\n')
        for i, e in ipairs(events) do
            local sep = (i < #events) and "," or ""
            out:write(string.format(
                '    {"frame": %d, "byte": %d, "soundRun": %s}%s\n',
                e.frame, e.byte, tostring(e.soundRun), sep))
        end
        out:write("  ]\n")
        out:write("}\n")
        out:close()
        print(string.format("[sound_reset_tap] dumped %d events, firstReleaseFrame=%d → %s",
            #events, first_release_frame, OUT_PATH))
        manager.machine:exit()
    end
end)
