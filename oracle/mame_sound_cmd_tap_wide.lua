-- mame_sound_cmd_tap_wide.lua — debug: capture qualunque write a $FE0000-$FEFFFF
-- per identificare l'address giusto del soundlatch marble.

local TARGET_FRAME = tonumber(os.getenv("MARBLE_SOUND_CMD_TARGET_FRAME") or "600")
local OUT_PATH = os.getenv("MARBLE_SOUND_CMD_OUT") or "/tmp/mame_sound_cmds_wide.json"

local maincpu = nil
local main_mem = nil
local writes = {}
local frame_count = 0
local tap_installed = false
local addr_histogram = {}

local function install_tap()
    if tap_installed then return end
    maincpu = manager.machine.devices[":maincpu"]
    if maincpu == nil then return end
    main_mem = maincpu.spaces["program"]
    main_mem:install_write_tap(0xFE0000, 0xFEFFFF, "sound_wide", function(o, d, m)
        addr_histogram[o] = (addr_histogram[o] or 0) + 1
        if #writes < 200 then
            table.insert(writes, { frame = frame_count, addr = o, data = d, mask = m })
        end
    end)
    print("[sound_cmd_tap_wide] tap installed on $FE0000-$FEFFFF")
    tap_installed = true
end

emu.register_frame_done(function()
    install_tap()
    frame_count = frame_count + 1
    if frame_count >= TARGET_FRAME then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write("{\n")
        out:write(string.format('  "frame": %d,\n', frame_count))
        out:write(string.format('  "total_writes": %d,\n', #writes))
        out:write('  "histogram": {\n')
        local entries = {}
        for k, v in pairs(addr_histogram) do
            table.insert(entries, string.format('    "0x%06x": %d', k, v))
        end
        out:write(table.concat(entries, ",\n"))
        out:write("\n  },\n")
        out:write('  "writes": [\n')
        for i, w in ipairs(writes) do
            local sep = (i < #writes) and "," or ""
            out:write(string.format('    {"frame": %d, "addr": "0x%06x", "data": "0x%04x", "mask": "0x%04x"}%s\n',
                w.frame, w.addr, w.data, w.mask, sep))
        end
        out:write("  ]\n")
        out:write("}\n")
        out:close()
        print(string.format("[sound_cmd_tap_wide] %d writes across %d frames", #writes, frame_count))
        manager.machine:exit()
    end
end)
