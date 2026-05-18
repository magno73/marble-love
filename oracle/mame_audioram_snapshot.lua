-- mame_audioram_snapshot.lua — snapshot audioRam $0000-$0FFF a frame
-- target. Confronto byte-by-byte con TS audioRam allo stesso frame
-- identifica divergenza che spiega il music dispatch trigger lag.
local OUT_PATH = "/tmp/mame_audioram.json"
local SNAPSHOT_FRAMES = {350, 360, 370, 374, 375, 380, 400}
local audiocpu, sound_mem
local frame_count = 0
local installed = false
local snapshots = {}

emu.register_frame_done(function()
    if not installed then
        for _, t in ipairs({":audiocpu", ":soundcpu"}) do
            if manager.machine.devices[t] then audiocpu = manager.machine.devices[t]; break end
        end
        sound_mem = audiocpu.spaces["program"]
        installed = true
        print("[audioram] installed")
    end
    frame_count = frame_count + 1
    for _, sf in ipairs(SNAPSHOT_FRAMES) do
        if frame_count == sf then
            local bytes = {}
            for addr = 0, 0xFFF do
                bytes[#bytes+1] = sound_mem:read_u8(addr)
            end
            snapshots[sf] = bytes
            print(string.format("[audioram] snapshot frame %d: %d bytes", sf, #bytes))
        end
    end
    if frame_count >= 410 then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write("{\"snapshots\":{\n")
        local first = true
        for sf, bytes in pairs(snapshots) do
            if not first then out:write(",\n") end
            first = false
            out:write(string.format('  "%d": [', sf))
            for i, b in ipairs(bytes) do
                if i > 1 then out:write(",") end
                out:write(tostring(b))
            end
            out:write("]")
        end
        out:write("\n}}\n")
        out:close()
        print("[audioram] saved")
        manager.machine:exit()
    end
end)
