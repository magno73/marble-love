local TARGET_FRAME = tonumber(os.getenv("MARBLE_POKEY_TARGET") or "14000")
local OUT_PATH = os.getenv("MARBLE_POKEY_OUT") or "/tmp/mame_pokey_writes.json"
local COIN_FRAME = 1200
local START_FRAME = 1500
local PULSE_LEN = 15
local maincpu, audiocpu, sound_mem, ports
local frame_count = 0
local installed = false
local tap_handles = {}
local writes = {}
local function in_pulse(f, s) return f >= s and f < s + PULSE_LEN end

emu.register_frame_done(function()
    if not installed then
        maincpu = manager.machine.devices[":maincpu"]
        local main_mem = maincpu.spaces["program"]
        for _, t in ipairs({":audiocpu", ":soundcpu"}) do
            if manager.machine.devices[t] then audiocpu = manager.machine.devices[t]; break end
        end
        sound_mem = audiocpu.spaces["program"]
        ports = manager.machine.ioport.ports
        table.insert(tap_handles, main_mem:install_read_tap(0xF60000, 0xF60003, "p_sw", function(o,d,m) return d end))
        table.insert(tap_handles, sound_mem:install_read_tap(0x1820, 0x1820, "p_coin", function(o,d,m) return d end))
        -- POKEY at 0x1870-0x187F mirror 0x2780. Tap 0x1000-0x3FFF, filter
        table.insert(tap_handles, sound_mem:install_write_tap(0x1000, 0x3FFF, "p_w", function(o, d, m)
            local masked = o & 0xD87F
            if (masked & 0xFFF0) == 0x1870 then
                if true then
                    local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
                    if (d & 0xff) ~= 0 then table.insert(writes, { frame = frame_count, reg = o & 0x0F, data = d & 0xff, pc = pc }) end
                end
            end
            return d
        end))
        installed = true
        print("[pokey] tap installed")
    end
    frame_count = frame_count + 1
    if ports[":1820"] and ports[":1820"].fields["Coin 1"] then
        ports[":1820"].fields["Coin 1"]:set_value(in_pulse(frame_count + 1, COIN_FRAME) and 0 or 1)
    end
    if ports[":F60000"] and ports[":F60000"].fields["1 Player Start"] then
        ports[":F60000"].fields["1 Player Start"]:set_value(in_pulse(frame_count + 1, START_FRAME) and 1 or 0)
    end
    if frame_count >= TARGET_FRAME then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write(string.format('{"writeCount": %d, "writes": [\n', #writes))
        for i, w in ipairs(writes) do
            local sep = (i < #writes) and "," or ""
            out:write(string.format('  {"frame":%d,"reg":"0x%x","data":"0x%02x","pc":"0x%04x"}%s\n', w.frame, w.reg, w.data, w.pc, sep))
        end
        out:write("]}\n")
        out:close()
        print(string.format("[pokey] %d writes saved", #writes))
        manager.machine:exit()
    end
end)
