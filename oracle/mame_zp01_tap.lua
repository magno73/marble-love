-- mame_zp01_tap.lua — log zp[$01] at the moment of the $81D5 LDA $01 check
local OUT_PATH = "/tmp/mame_zp01.json"
local TARGET_FRAME = 500
local audiocpu, sound_mem
local frame_count = 0
local installed = false
local tap_handles = {}
local hits = {}

emu.register_frame_done(function()
    if not installed then
        for _, t in ipairs({":audiocpu", ":soundcpu"}) do
            if manager.machine.devices[t] then audiocpu = manager.machine.devices[t]; break end
        end
        sound_mem = audiocpu.spaces["program"]
        -- (LDA $01 inside IRQ handler at $81D3)
        table.insert(tap_handles, sound_mem:install_read_tap(0x01, 0x01, "zp01",
            function(o, d, m)
                local pc = audiocpu.state["PC"].value
                if pc == 0x81D3 and #hits < 500 then
                    local t = manager.machine.time
                    table.insert(hits, { val = d, secs = t.seconds, attos = t.attoseconds, frame = frame_count })
                end
                return d
            end))
        installed = true
        print("[zp01] installed")
    end
    frame_count = frame_count + 1
    if frame_count >= TARGET_FRAME then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write("{\"hits\":[\n")
        for i, h in ipairs(hits) do
            local sep = (i < #hits) and "," or ""
            out:write(string.format('  {"val":"0x%02x","frame":%d,"secs":%d,"attos":"%s"}%s\n',
                h.val, h.frame, h.secs, tostring(h.attos), sep))
        end
        out:write("]}\n")
        out:close()
        print(string.format("[zp01] saved %d hits", #hits))
        manager.machine:exit()
    end
end)
