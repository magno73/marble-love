-- check main CPU activity + sound CPU activity
local TARGET_FRAME = tonumber(os.getenv("MARBLE_TARGET_FRAME") or "300")

local frame_count = 0
local main_writes = 0
local sound_writes = 0
local main_pc_samples = {}
local sound_pc_samples = {}
local maincpu, audiocpu = nil, nil

emu.register_frame_done(function()
    if maincpu == nil then maincpu = manager.machine.devices[":maincpu"] end
    if audiocpu == nil then audiocpu = manager.machine.devices[":audiocpu"] end
    if maincpu and #main_pc_samples < 10 then
        table.insert(main_pc_samples, string.format("%06x", maincpu.state["PC"].value))
    end
    if audiocpu and #sound_pc_samples < 10 then
        table.insert(sound_pc_samples, string.format("%04x", audiocpu.state["PC"].value))
    end
    frame_count = frame_count + 1
    if frame_count >= TARGET_FRAME then
        print(string.format("[check] frame=%d", frame_count))
        print(string.format("[check] main PCs sampled: %s", table.concat(main_pc_samples, ",")))
        print(string.format("[check] sound PCs sampled: %s", table.concat(sound_pc_samples, ",")))
        if maincpu then
            for k, v in pairs(maincpu.state) do
                if k == "PC" or k == "SR" then
                    print(string.format("[check] main %s = %x", k, v.value))
                end
            end
        end
        if audiocpu then
            for k, v in pairs(audiocpu.state) do
                if k == "PC" or k == "A" or k == "SP" then
                    print(string.format("[check] sound %s = %x", k, v.value))
                end
            end
        end
        manager.machine:exit()
    end
end)
