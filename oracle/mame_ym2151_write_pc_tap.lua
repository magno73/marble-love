-- mame_ym2151_write_pc_tap.lua - records every YM2151 write with the PC of the
-- sound 6502 al momento del write. Permette di mappare ogni reg write a una
-- specific code location nel sound ROM.
--
-- Output: list of (addr, data, PC) for the first N writes.

local TARGET_FRAME = tonumber(os.getenv("MARBLE_YM_PC_TAP_FRAMES") or "500")
local OUT_PATH = os.getenv("MARBLE_YM_PC_TAP_OUT") or "/tmp/mame_ym_pc_writes.json"
local COIN_FRAME = tonumber(os.getenv("MARBLE_SOUND_COIN_FRAME") or "1200")
local START_FRAME = tonumber(os.getenv("MARBLE_SOUND_START_FRAME") or "1500")
local MAX_WRITES = tonumber(os.getenv("MARBLE_YM_PC_TAP_MAX") or "200")
local PULSE_LEN = 15

local maincpu, main_mem
local audiocpu, sound_mem
local ports
local frame_count = 0
local installed = false
local tap_handles = {}
local writes = {}     -- {frame, addr, data, pc}
local current_reg = -1

local function in_pulse(frame, start)
    return frame >= start and frame < (start + PULSE_LEN)
end

local function install_taps()
    maincpu = manager.machine.devices[":maincpu"]
    main_mem = maincpu.spaces["program"]
    for _, tag in ipairs({":audiocpu", ":soundcpu"}) do
        if manager.machine.devices[tag] then audiocpu = manager.machine.devices[tag]; break end
    end
    sound_mem = audiocpu.spaces["program"]
    ports = manager.machine.ioport.ports

    table.insert(tap_handles,
        main_mem:install_read_tap(0xF60000, 0xF60003, "ym_pc_sw", function(o, d, m) return d end))
    table.insert(tap_handles,
        sound_mem:install_read_tap(0x1820, 0x1820, "ym_pc_coin", function(o, d, m) return d end))

    -- Write tap with PC capture
    table.insert(tap_handles,
        sound_mem:install_write_tap(0x1000, 0x3FFF, "ym_pc_w", function(o, d, m)
            local masked = o & 0xD871
            if masked == 0x1800 or masked == 0x1801 then
                if #writes < MAX_WRITES then
                    local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
                    if masked == 0x1800 then current_reg = d & 0xff end
                    table.insert(writes, {
                        frame = frame_count,
                        addr = masked,
                        data = d & 0xff,
                        pc = pc,
                        reg = (masked == 0x1801) and current_reg or -1,
                    })
                end
            end
            return d
        end))

    print(string.format("[ym_pc_tap] installed; coin=f%d start=f%d max_writes=%d",
        COIN_FRAME, START_FRAME, MAX_WRITES))
end

local function apply_input(frame)
    if ports == nil then return end
    local coin_port = ports[":1820"]
    if coin_port and coin_port.fields["Coin 1"] then
        coin_port.fields["Coin 1"]:set_value(in_pulse(frame, COIN_FRAME) and 1 or 0)
    end
    local start_port = ports[":F60000"]
    if start_port and start_port.fields["1 Player Start"] then
        start_port.fields["1 Player Start"]:set_value(in_pulse(frame, START_FRAME) and 1 or 0)
    end
end

emu.register_frame_done(function()
    if not installed then
        install_taps()
        installed = true
    end
    frame_count = frame_count + 1
    apply_input(frame_count + 1)
    if frame_count >= TARGET_FRAME then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write("{\n")
        out:write(string.format('  "frame": %d,\n', frame_count))
        out:write(string.format('  "writeCount": %d,\n', #writes))
        out:write('  "writes": [\n')
        for i, w in ipairs(writes) do
            local sep = (i < #writes) and "," or ""
            local kind = (w.addr == 0x1800) and "SEL" or "DATA"
            local reg_field = (w.reg >= 0) and string.format(', "reg": "0x%02x"', w.reg) or ''
            out:write(string.format(
                '    {"frame": %d, "kind": "%s", "addr": "0x%04x", "data": "0x%02x", "pc": "0x%04x"%s}%s\n',
                w.frame, kind, w.addr, w.data, w.pc, reg_field, sep))
        end
        out:write("  ]\n")
        out:write("}\n")
        out:close()
        print(string.format("[ym_pc_tap] saved %d writes", #writes))
        manager.machine:exit()
    end
end)
