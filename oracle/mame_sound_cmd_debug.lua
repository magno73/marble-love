-- mame_sound_cmd_debug.lua — full diagnostic:
--   1) List ALL port names + fields at boot
--   2) Wide write tap on $F00000-$FFFFFF, top 30 addresses
--   3) Inject coin+start with set_value above the default value
--   4) Print every 200 frames: PC main, PC sound, write count so far

local TARGET_FRAME = tonumber(os.getenv("MARBLE_SOUND_CMD_TARGET_FRAME") or "2400")
local OUT_PATH = os.getenv("MARBLE_SOUND_CMD_OUT") or "/tmp/mame_sound_debug.json"
local COIN_FRAME = tonumber(os.getenv("MARBLE_SOUND_COIN_FRAME") or "1200")
local START_FRAME = tonumber(os.getenv("MARBLE_SOUND_START_FRAME") or "1500")
local PULSE_LEN = 15

local maincpu = nil
local main_mem = nil
local audiocpu = nil
local ports = nil
local frame_count = 0
local installed = false
local histogram = {}
local fe_writes = {}

local function in_pulse(frame, start)
    return frame >= start and frame < (start + PULSE_LEN)
end

local function install()
    if installed then return end
    maincpu = manager.machine.devices[":maincpu"]
    if maincpu == nil then return end
    main_mem = maincpu.spaces["program"]
    for _, tag in ipairs({":audiocpu", ":soundcpu"}) do
        if manager.machine.devices[tag] ~= nil then
            audiocpu = manager.machine.devices[tag]
            break
        end
    end

    main_mem:install_write_tap(0xF00000, 0xFFFFFF, "wide_w", function(o, d, m)
        histogram[o] = (histogram[o] or 0) + 1
        if (o == 0xFE0000 or o == 0xFE0001) and (m & 0xff) ~= 0 then
            table.insert(fe_writes, { frame = frame_count, addr = o, data = d, mask = m })
        end
    end)

    ports = manager.machine.ioport.ports
    print("[debug] Ports:")
    for name, _ in pairs(ports) do
        print(string.format("  port: %s", name))
        local port = ports[name]
        if port and port.fields then
            for fname, _ in pairs(port.fields) do
                print(string.format("    field: %s", fname))
            end
        end
    end
    installed = true
end

local function apply_input(frame)
    if ports == nil then return end
    local coin_pressed = in_pulse(frame, COIN_FRAME)
    local start_pressed = in_pulse(frame, START_FRAME)

    local coin_port = ports[":1820"]
    if coin_port then
        if coin_port.fields["Coin 1"] then
            coin_port.fields["Coin 1"]:set_value(coin_pressed and 1 or 0)
        end
        if coin_port.fields["Left Coin"] then
            coin_port.fields["Left Coin"]:set_value(1)
        end
        if coin_port.fields["Right Coin"] then
            coin_port.fields["Right Coin"]:set_value(1)
        end
    end
    local start_port = ports[":F60000"]
    if start_port and start_port.fields["1 Player Start"] then
        start_port.fields["1 Player Start"]:set_value(start_pressed and 1 or 0)
    end
end

local function status(frame)
    if frame % 200 ~= 0 then return end
    local pc_main = maincpu and maincpu.state["PC"] and maincpu.state["PC"].value or -1
    local pc_snd = audiocpu and audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
    print(string.format("[debug] f%d main_pc=%06x snd_pc=%04x total_writes=%d fe_writes=%d",
        frame, pc_main, pc_snd, (function() local n=0; for _,c in pairs(histogram) do n=n+c end; return n end)(), #fe_writes))
end

emu.register_frame_done(function()
    install()
    frame_count = frame_count + 1
    apply_input(frame_count + 1)
    status(frame_count)
    if frame_count >= TARGET_FRAME then
        -- dump histogram top 30
        local entries = {}
        for addr, count in pairs(histogram) do
            table.insert(entries, { addr = addr, count = count })
        end
        table.sort(entries, function(a, b) return a.count > b.count end)
        local out = assert(io.open(OUT_PATH, "w"))
        out:write("{\n")
        out:write(string.format('  "totalFrames": %d,\n', frame_count))
        out:write(string.format('  "feWriteCount": %d,\n', #fe_writes))
        out:write('  "feWrites": [\n')
        for i, w in ipairs(fe_writes) do
            local sep = (i < #fe_writes) and "," or ""
            out:write(string.format('    {"frame": %d, "addr": "0x%06x", "data": "0x%04x", "mask": "0x%04x"}%s\n',
                w.frame, w.addr, w.data, w.mask, sep))
            if i >= 50 then break end
        end
        out:write("  ],\n")
        out:write('  "topAddrs": [\n')
        for i = 1, math.min(30, #entries) do
            local e = entries[i]
            local sep = (i < math.min(30, #entries)) and "," or ""
            out:write(string.format('    {"addr": "0x%06x", "count": %d}%s\n', e.addr, e.count, sep))
        end
        out:write("  ]\n")
        out:write("}\n")
        out:close()
        print(string.format("[debug] dumped %d FE writes, %d unique addrs in $F00000-$FFFFFF",
            #fe_writes, #entries))
        manager.machine:exit()
    end
end)
