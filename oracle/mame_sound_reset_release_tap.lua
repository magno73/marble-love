-- mame_sound_reset_release_tap.lua — identifica quando main 68K rilascia il
-- sound 6502 dal hold reset.
--
-- Atarisy1: scrittura a $860001 bit 7 == 1 rilascia il sound CPU.
-- bankselect_w in atarisy1.cpp si occupa di sia bank select che sound reset.
--
-- Inoltre cattura il primo cmd writes a $FE0001 e dumpa snapshot audioRam
-- (sound CPU RAM $0000-$0FFF) ai frame intorno al reset release.

local OUT_PATH = os.getenv("MARBLE_RST_OUT") or "/tmp/mame_reset_release.json"
local TARGET_FRAME = tonumber(os.getenv("MARBLE_RST_TARGET") or "1500")
local COIN_FRAME = tonumber(os.getenv("MARBLE_SOUND_COIN_FRAME") or "1200")
local START_FRAME = tonumber(os.getenv("MARBLE_SOUND_START_FRAME") or "1500")
local PULSE_LEN = 15

local maincpu, main_mem
local audiocpu, sound_mem
local ports
local frame_count = 0
local installed = false
local bank_writes = {}    -- $860001 writes
local cmd_writes = {}     -- $FE0001 writes
local audioram_dumps = {} -- snapshot audioRam at key frames
local tap_handles = {}
local first_cmd_frame = -1
local first_bank_bit7_set_frame = -1

local function in_pulse(frame, start)
    return frame >= start and frame < (start + PULSE_LEN)
end

local function hex_region_sound(addr, size)
    local parts = {}
    for i = 0, size - 1 do
        parts[i + 1] = string.format("%02x", sound_mem:read_u8(addr + i))
    end
    return table.concat(parts)
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
        main_mem:install_read_tap(0xF60000, 0xF60003, "rst_sw", function(o, d, m) return d end))
    table.insert(tap_handles,
        sound_mem:install_read_tap(0x1820, 0x1820, "rst_coin", function(o, d, m) return d end))

    -- $860001 = bankselect_w in atarisy1.cpp. bit 7 = sound reset release (1=run).
    table.insert(tap_handles,
        main_mem:install_write_tap(0x860000, 0x860001, "rst_bank_w", function(o, d, m)
            if (m & 0xff) ~= 0 then
                local byte = d & 0xff
                table.insert(bank_writes, { frame = frame_count, byte = byte })
                if first_bank_bit7_set_frame < 0 and (byte & 0x80) ~= 0 then
                    first_bank_bit7_set_frame = frame_count
                    print(string.format("[reset_release] FIRST $860001 bit7=1 at f%d byte=$%02x", frame_count, byte))
                end
            end
            return d
        end))

    -- $FE0001 cmd write
    table.insert(tap_handles,
        main_mem:install_write_tap(0xFE0000, 0xFE0001, "rst_cmd_w", function(o, d, m)
            if (m & 0xff) ~= 0 then
                table.insert(cmd_writes, { frame = frame_count, byte = (d & 0xff) })
                if first_cmd_frame < 0 then
                    first_cmd_frame = frame_count
                    print(string.format("[reset_release] FIRST $FE0001 write at f%d byte=$%02x", frame_count, d & 0xff))
                end
            end
            return d
        end))

    print("[reset_release] taps installed")
end

local function apply_input(frame)
    if ports == nil then return end
    local coin_pressed = in_pulse(frame, COIN_FRAME)
    local start_pressed = in_pulse(frame, START_FRAME)
    local coin_port = ports[":1820"]
    if coin_port and coin_port.fields["Coin 1"] then
        coin_port.fields["Coin 1"]:set_value(coin_pressed and 0 or 1)
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

    -- Dump audioRam at key frames around first_cmd / first_bank_bit7
    if first_cmd_frame > 0 and frame_count >= first_cmd_frame and frame_count <= first_cmd_frame + 5 then
        local ar = hex_region_sound(0x0000, 0x100)  -- first 256 bytes only (zero page + stack low)
        table.insert(audioram_dumps, { frame = frame_count, audioRam_first256 = ar })
    end

    if frame_count >= TARGET_FRAME then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write("{\n")
        out:write(string.format('  "firstCmdFrame": %d,\n', first_cmd_frame))
        out:write(string.format('  "firstBankBit7SetFrame": %d,\n', first_bank_bit7_set_frame))
        out:write(string.format('  "bankWriteCount": %d,\n', #bank_writes))
        out:write(string.format('  "cmdWriteCount": %d,\n', #cmd_writes))
        out:write('  "bankWrites": [\n')
        for i, w in ipairs(bank_writes) do
            if i > 20 then break end
            local sep = (i < math.min(20, #bank_writes)) and "," or ""
            out:write(string.format('    {"frame": %d, "byte": "0x%02x"}%s\n', w.frame, w.byte, sep))
        end
        out:write("  ],\n")
        out:write('  "firstCmds": [\n')
        for i, w in ipairs(cmd_writes) do
            if i > 10 then break end
            local sep = (i < math.min(10, #cmd_writes)) and "," or ""
            out:write(string.format('    {"frame": %d, "byte": "0x%02x"}%s\n', w.frame, w.byte, sep))
        end
        out:write("  ],\n")
        out:write('  "audioRamSnapshots": [\n')
        for i, d in ipairs(audioram_dumps) do
            local sep = (i < #audioram_dumps) and "," or ""
            out:write(string.format('    {"frame": %d, "audioRam_first256": "%s"}%s\n', d.frame, d.audioRam_first256, sep))
        end
        out:write("  ]\n")
        out:write("}\n")
        out:close()
        print(string.format("[reset_release] saved to %s", OUT_PATH))
        manager.machine:exit()
    end
end)
