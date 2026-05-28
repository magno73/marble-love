-- mame_1820_value_tap.lua - records the exact value returned by $1820 at boot.
-- from the sound 6502. Finds the expected bit pattern to align TS sound-mmu.
local OUT_PATH = "/tmp/mame_1820_reads.json"
local TARGET_FRAME = 500
local audiocpu, sound_mem
local frame_count = 0
local installed = false
local tap_handles = {}
local reads = {}  -- list of {frame, value, pc}

emu.register_frame_done(function()
    if not installed then
        for _, t in ipairs({":audiocpu", ":soundcpu"}) do
            if manager.machine.devices[t] then audiocpu = manager.machine.devices[t]; break end
        end
        sound_mem = audiocpu.spaces["program"]
        table.insert(tap_handles, sound_mem:install_read_tap(0x1820, 0x1820, "tap_1820", function(o, d, m)
            if #reads < 200 then
                table.insert(reads, { frame = frame_count, value = d, pc = audiocpu.state["PC"].value })
            end
            return d
        end))
        installed = true
        print("[1820_tap] installed")
    end
    frame_count = frame_count + 1
    if frame_count >= TARGET_FRAME then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write("{\"reads\":[\n")
        for i, r in ipairs(reads) do
            local sep = (i < #reads) and "," or ""
            out:write(string.format('  {"f": %d, "pc": "0x%04x", "v": "0x%02x"}%s\n',
                r.frame, r.pc, r.value, sep))
        end
        out:write("]}\n")
        out:close()
        print(string.format("[1820_tap] saved %d reads", #reads))
        manager.machine:exit()
    end
end)
