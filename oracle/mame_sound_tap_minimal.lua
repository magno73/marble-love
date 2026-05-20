-- mame_sound_tap_minimal.lua — diagnose snd CPU mem space + try write tap
local audiocpu, sound_mem
local maincpu, main_mem
local frame_count = 0
local snd_r, snd_w = 0, 0
local installed = false

emu.register_frame_done(function()
    if not installed then
        for _, tag in ipairs({":audiocpu", ":soundcpu"}) do
            if manager.machine.devices[tag] then audiocpu = manager.machine.devices[tag]; break end
        end
        print(string.format("[min] audiocpu = %s", tostring(audiocpu)))
        print(string.format("[min] audiocpu.spaces = %s", tostring(audiocpu.spaces)))
        for name, _ in pairs(audiocpu.spaces) do
            print(string.format("[min]   space: %s", name))
        end
        sound_mem = audiocpu.spaces["program"]
        print(string.format("[min] sound_mem = %s", tostring(sound_mem)))
        print(string.format("[min] sound_mem.install_read_tap = %s", tostring(sound_mem.install_read_tap)))
        print(string.format("[min] sound_mem.install_write_tap = %s", tostring(sound_mem.install_write_tap)))

        -- Esattamente come playable_input_capture: lo=hi=0x1820
        local rt = sound_mem:install_read_tap(0x1820, 0x1820, "rtap", function(o, d, m)
            snd_r = snd_r + 1
            if snd_r < 5 then print(string.format("[min] snd READ tap: addr=%04x d=%02x", o, d)) end
            return d
        end)
        local wt = sound_mem:install_write_tap(0x1000, 0x3FFF, "wtap", function(o, d, m)
            snd_w = snd_w + 1
            if snd_w < 5 then print(string.format("[min] snd WRITE tap: addr=%04x d=%02x", o, d)) end
            return d
        end)
        print(string.format("[min] rt=%s wt=%s", tostring(rt), tostring(wt)))
        installed = true
    end
    frame_count = frame_count + 1
    if frame_count % 500 == 0 then
        print(string.format("[min] f%d snd reads=%d writes=%d", frame_count, snd_r, snd_w))
    end
    if frame_count == 2000 then
        manager.machine:exit()
    end
end)
