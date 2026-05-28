-- mame_ym2151_write_tap.lua — registra ogni write del sound 6502 a $1800/$1801
-- (YM2151 register select + data). Output the full sequence for comparison
-- against the TS chip, which currently does not write voice registers.
--
-- Sound 6502 $1800 = register address write; $1801 = register data write.
-- Pattern: STA $1800 (select reg N), STA $1801 (write data D) → reg[N] = D.
--
-- Env:
--   MARBLE_YM_TAP_FRAMES   max frames (default 1500)
--   MARBLE_YM_TAP_OUT      output JSON (default /tmp/mame_ym_writes.json)
--   MARBLE_SOUND_COIN_FRAME, MARBLE_SOUND_START_FRAME come capture script

local TARGET_FRAME = tonumber(os.getenv("MARBLE_YM_TAP_FRAMES") or "1500")
local OUT_PATH = os.getenv("MARBLE_YM_TAP_OUT") or "/tmp/mame_ym_writes.json"
local COIN_FRAME = tonumber(os.getenv("MARBLE_SOUND_COIN_FRAME") or "1200")
local START_FRAME = tonumber(os.getenv("MARBLE_SOUND_START_FRAME") or "1500")
local PULSE_LEN = 15

local maincpu, main_mem
local audiocpu, sound_mem
local ports
local frame_count = 0
local installed = false
local tap_handles = {}
local ym_writes = {}    -- {frame, addr, reg, data} dove addr = $1800 o $1801
local current_reg = -1  -- last $1800 write
local reg_writes = {}   -- {frame, reg, data} pairs ricostruiti

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
        main_mem:install_read_tap(0xF60000, 0xF60003, "ym_sw", function(o, d, m) return d end))
    table.insert(tap_handles,
        sound_mem:install_read_tap(0x1820, 0x1820, "ym_coin", function(o, d, m) return d end))

    -- write tap on $1800 (mirror 0x278f -> capture range 0x1000-0x3FFF, filter)
    table.insert(tap_handles,
        sound_mem:install_write_tap(0x1000, 0x3FFF, "ym_w", function(o, d, m)
            -- atarisy1 sound_map: $1800-$1801 with mirror 0x278e (bit 0 distinguishes
            -- select/data). Mask = ~0x278e & 0xFFFF = 0xD871.
            local masked = o & 0xD871
            if masked == 0x1800 then
                -- $1800 select
                current_reg = d & 0xff
                table.insert(ym_writes, { frame = frame_count, addr = 0x1800, data = d & 0xff })
            elseif masked == 0x1801 then
                -- $1801 data write — record (current_reg, data)
                if current_reg >= 0 then
                    table.insert(reg_writes, { frame = frame_count, reg = current_reg, data = d & 0xff })
                end
                table.insert(ym_writes, { frame = frame_count, addr = 0x1801, data = d & 0xff })
            end
            return d
        end))

    print(string.format("[ym_write_tap] taps installed; coin=f%d start=f%d target=f%d",
        COIN_FRAME, START_FRAME, TARGET_FRAME))
end

local function apply_input(frame)
    if ports == nil then return end
    local coin_pressed = in_pulse(frame, COIN_FRAME)
    local start_pressed = in_pulse(frame, START_FRAME)
    local coin_port = ports[":1820"]
    if coin_port and coin_port.fields["Coin 1"] then
        coin_port.fields["Coin 1"]:set_value(coin_pressed and 1 or 0)
    end
    local start_port = ports[":F60000"]
    if start_port and start_port.fields["1 Player Start"] then
        start_port.fields["1 Player Start"]:set_value(start_pressed and 1 or 0)
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
        out:write(string.format('  "totalFrames": %d,\n', frame_count))
        out:write(string.format('  "rawWriteCount": %d,\n', #ym_writes))
        out:write(string.format('  "regWriteCount": %d,\n', #reg_writes))
        out:write('  "regWrites": [\n')
        for i, w in ipairs(reg_writes) do
            local sep = (i < #reg_writes) and "," or ""
            out:write(string.format('    {"frame": %d, "reg": "0x%02x", "data": "0x%02x"}%s\n',
                w.frame, w.reg, w.data, sep))
        end
        out:write("  ],\n")
        out:write('  "rawWrites": [\n')
        for i, w in ipairs(ym_writes) do
            if i > 50 then break end
            local sep = (i < math.min(50, #ym_writes)) and "," or ""
            out:write(string.format('    {"frame": %d, "addr": "0x%04x", "data": "0x%02x"}%s\n',
                w.frame, w.addr, w.data, sep))
        end
        out:write("  ]\n")
        out:write("}\n")
        out:close()
        print(string.format("[ym_write_tap] saved %d reg writes (%d raw) to %s",
            #reg_writes, #ym_writes, OUT_PATH))
        manager.machine:exit()
    end
end)
