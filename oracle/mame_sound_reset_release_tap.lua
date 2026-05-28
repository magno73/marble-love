-- mame_sound_reset_release_tap.lua - identifies when main 68K releases the
-- sound 6502 dal hold reset.
--
-- Atarisy1: write to $860001 bit 7 == 1 releases the sound CPU.
-- bankselect_w in atarisy1.cpp handles both bank select and sound reset.
--
-- Also captures the first cmd writes to $FE0001 and dumps an audioRam snapshot.
-- (sound CPU RAM $0000-$0FFF) ai frame intorno al reset release.

local OUT_PATH = os.getenv("MARBLE_RST_OUT") or "/tmp/mame_reset_release.json"
local TARGET_FRAME = tonumber(os.getenv("MARBLE_RST_TARGET") or "1500")
local COIN_FRAME = tonumber(os.getenv("MARBLE_SOUND_COIN_FRAME") or "1200")
local START_FRAME = tonumber(os.getenv("MARBLE_SOUND_START_FRAME") or "1500")
local SOUND_CPU_HZ = tonumber(os.getenv("MARBLE_SOUND_CPU_HZ") or "1789772.625")
local PULSE_LEN = 15

local maincpu, main_mem
local audiocpu, sound_mem
local ports
local frame_count = 0
local installed = false
local bank_writes = {}    -- $860001 writes
local cmd_writes = {}     -- $FE0001 writes
local reset_vector_reads = {}
local first_pc_fetches = {}
local audioram_dumps = {} -- snapshot audioRam at key frames
local tap_handles = {}
local frame_start_time = {}
local first_cmd_frame = -1
local first_bank_bit7_set_frame = -1
local first_cmd_event = nil
local first_bank_bit7_set_event = nil
local first_reset_fetch_event = nil

local function in_pulse(frame, start)
    return frame >= start and frame < (start + PULSE_LEN)
end

local function timestamp()
    local t = manager.machine.time
    return t.seconds, tostring(t.attoseconds)
end

local function timestamp_seconds(secs, attos)
    return secs + (tonumber(attos) / 1000000000000000000.0)
end

local function current_cycle_in_frame(secs, attos)
    local start = frame_start_time[frame_count]
    if start == nil then return nil end
    return math.floor(((timestamp_seconds(secs, attos) - start) * SOUND_CPU_HZ) + 0.5)
end

local function sound_cpu_state()
    if audiocpu == nil then return {} end
    return {
        soundPc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1,
        soundA = audiocpu.state["A"] and audiocpu.state["A"].value or -1,
        soundX = audiocpu.state["X"] and audiocpu.state["X"].value or -1,
        soundY = audiocpu.state["Y"] and audiocpu.state["Y"].value or -1,
        soundP = audiocpu.state["P"] and audiocpu.state["P"].value or -1,
        soundSp = audiocpu.state["SP"] and audiocpu.state["SP"].value or -1,
    }
end

local function main_pc()
    return maincpu.state["PC"] and maincpu.state["PC"].value or -1
end

local function make_main_event(byte)
    local secs, attos = timestamp()
    local event = {
        frame = frame_count,
        byte = byte & 0xff,
        pc = main_pc(),
        secs = secs,
        attos = attos,
        cycleInFrame = current_cycle_in_frame(secs, attos),
    }
    for k, v in pairs(sound_cpu_state()) do event[k] = v end
    return event
end

local function make_sound_event(extra)
    local secs, attos = timestamp()
    local event = {
        frame = frame_count,
        secs = secs,
        attos = attos,
        cycleInFrame = current_cycle_in_frame(secs, attos),
    }
    for k, v in pairs(sound_cpu_state()) do event[k] = v end
    for k, v in pairs(extra) do event[k] = v end
    return event
end

local function delta_cycles(a, b)
    if a == nil or b == nil then return nil end
    return math.floor(((timestamp_seconds(b.secs, b.attos) - timestamp_seconds(a.secs, a.attos)) * SOUND_CPU_HZ) + 0.5)
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
                local event = make_main_event(byte)
                table.insert(bank_writes, event)
                if first_bank_bit7_set_frame < 0 and (byte & 0x80) ~= 0 then
                    first_bank_bit7_set_frame = frame_count
                    first_bank_bit7_set_event = event
                    print(string.format("[reset_release] FIRST $860001 bit7=1 at f%d byte=$%02x", frame_count, byte))
                end
            end
            return d
        end))

    -- $FE0001 cmd write
    table.insert(tap_handles,
        main_mem:install_write_tap(0xFE0000, 0xFE0001, "rst_cmd_w", function(o, d, m)
            if (m & 0xff) ~= 0 then
                local event = make_main_event(d & 0xff)
                table.insert(cmd_writes, event)
                if first_cmd_frame < 0 then
                    first_cmd_frame = frame_count
                    first_cmd_event = event
                    print(string.format("[reset_release] FIRST $FE0001 write at f%d byte=$%02x", frame_count, d & 0xff))
                end
            end
            return d
        end))

    table.insert(tap_handles,
        sound_mem:install_read_tap(0xfffc, 0xffff, "rst_vector_read", function(o, d, m)
            if first_bank_bit7_set_frame >= 0 and first_reset_fetch_event == nil and #reset_vector_reads < 8 then
                table.insert(reset_vector_reads, make_sound_event({
                    addr = o,
                    val = d & 0xff,
                    vector = (o == 0xfffc or o == 0xfffd) and "reset" or "irq",
                }))
            end
            return d
        end))

    table.insert(tap_handles,
        sound_mem:install_read_tap(0x8000, 0xffff, "rst_pc_fetch", function(o, d, m)
            if first_bank_bit7_set_frame >= 0 and #first_pc_fetches < 16 then
                local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
                if pc == o then
                    local event = make_sound_event({ pc = pc, opcode = d & 0xff })
                    table.insert(first_pc_fetches, event)
                    if first_reset_fetch_event == nil then first_reset_fetch_event = event end
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
    local secs, attos = timestamp()
    frame_start_time[frame_count] = timestamp_seconds(secs, attos)
    apply_input(frame_count + 1)

    -- Dump audioRam at key frames around first_cmd / first_bank_bit7
    if first_cmd_frame > 0 and frame_count >= first_cmd_frame and frame_count <= first_cmd_frame + 5 then
        local ar = hex_region_sound(0x0000, 0x100)  -- first 256 bytes only (zero page + stack low)
        table.insert(audioram_dumps, { frame = frame_count, audioRam_first256 = ar })
    end

    if frame_count >= TARGET_FRAME then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write("{\n")
        out:write(string.format('  "soundCpuHz": %.9f,\n', SOUND_CPU_HZ))
        out:write(string.format('  "firstCmdFrame": %d,\n', first_cmd_frame))
        out:write(string.format('  "firstBankBit7SetFrame": %d,\n', first_bank_bit7_set_frame))
        out:write('  "firstResetAnalysis": {\n')
        out:write(string.format('    "cmdToBankBit7Cycles": %s,\n',
            tostring(delta_cycles(first_cmd_event, first_bank_bit7_set_event) or "null")))
        out:write(string.format('    "bankBit7ToFirstFetchCycles": %s,\n',
            tostring(delta_cycles(first_bank_bit7_set_event, first_reset_fetch_event) or "null")))
        out:write(string.format('    "cmdToFirstFetchCycles": %s\n',
            tostring(delta_cycles(first_cmd_event, first_reset_fetch_event) or "null")))
        out:write("  },\n")
        out:write(string.format('  "bankWriteCount": %d,\n', #bank_writes))
        out:write(string.format('  "cmdWriteCount": %d,\n', #cmd_writes))
        out:write('  "bankWrites": [\n')
        for i, w in ipairs(bank_writes) do
            if i > 20 then break end
            local sep = (i < math.min(20, #bank_writes)) and "," or ""
            out:write(string.format(
                '    {"frame": %d, "byte": "0x%02x", "pc": "0x%04x", "soundPc": "0x%04x", "secs": %d, "attos": "%s"',
                w.frame, w.byte, w.pc, w.soundPc, w.secs, w.attos))
            if w.cycleInFrame ~= nil then out:write(string.format(', "cycleInFrame": %d', w.cycleInFrame)) end
            out:write(string.format('}%s\n', sep))
        end
        out:write("  ],\n")
        out:write('  "firstCmds": [\n')
        for i, w in ipairs(cmd_writes) do
            if i > 10 then break end
            local sep = (i < math.min(10, #cmd_writes)) and "," or ""
            out:write(string.format(
                '    {"frame": %d, "byte": "0x%02x", "pc": "0x%04x", "soundPc": "0x%04x", "secs": %d, "attos": "%s"',
                w.frame, w.byte, w.pc, w.soundPc, w.secs, w.attos))
            if w.cycleInFrame ~= nil then out:write(string.format(', "cycleInFrame": %d', w.cycleInFrame)) end
            out:write(string.format('}%s\n', sep))
        end
        out:write("  ],\n")
        out:write('  "resetVectorReads": [\n')
        for i, w in ipairs(reset_vector_reads) do
            local sep = (i < #reset_vector_reads) and "," or ""
            out:write(string.format(
                '    {"frame": %d, "addr": "0x%04x", "val": "0x%02x", "vector": "%s", "soundPc": "0x%04x", "secs": %d, "attos": "%s"',
                w.frame, w.addr, w.val, w.vector, w.soundPc, w.secs, w.attos))
            if w.cycleInFrame ~= nil then out:write(string.format(', "cycleInFrame": %d', w.cycleInFrame)) end
            out:write(string.format('}%s\n', sep))
        end
        out:write("  ],\n")
        out:write('  "firstPcFetches": [\n')
        for i, w in ipairs(first_pc_fetches) do
            local sep = (i < #first_pc_fetches) and "," or ""
            out:write(string.format(
                '    {"frame": %d, "pc": "0x%04x", "opcode": "0x%02x", "secs": %d, "attos": "%s"',
                w.frame, w.pc, w.opcode, w.secs, w.attos))
            if w.cycleInFrame ~= nil then out:write(string.format(', "cycleInFrame": %d', w.cycleInFrame)) end
            out:write(string.format('}%s\n', sep))
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
