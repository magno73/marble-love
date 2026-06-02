-- mame_sound_dump.lua - dumps sound chip state (6502 + YM2151 + POKEY +
-- mailbox) at a specific frame. Output: JSON with audiocpu regs, audioRam,
-- mailbox, ym2151 e pokey register shadow.
--
-- Environment variables:
--   MARBLE_SOUND_DUMP_TARGET_FRAME — frame at which to save (default 600)
--   MARBLE_SOUND_DUMP_OUT          — file output (default /tmp/mame_sound_state.json)

local TARGET_FRAME = tonumber(os.getenv("MARBLE_SOUND_DUMP_TARGET_FRAME") or "600")
local OUT_PATH = os.getenv("MARBLE_SOUND_DUMP_OUT") or "/tmp/mame_sound_state.json"

local audiocpu = nil
local audio_mem = nil
local ymsnd = nil
local pokey = nil
local soundlatch = nil
local mainlatch = nil
local frame_count = 0

-- Shadow buffer updated by pre_write_tap (fallback if device state
-- do not natively expose the internal register array).
local ym_shadow = {}  -- 256 byte, indici 0..255
local ym_latched_reg = 0  -- last register selected through a $1800 write
local pokey_shadow = {}  -- 16 byte, indici 0..15
for i = 0, 255 do ym_shadow[i] = 0 end
for i = 0, 15 do pokey_shadow[i] = 0 end

local function find_device(candidates, label)
    for _, tag in ipairs(candidates) do
        if manager.machine.devices[tag] ~= nil then
            print(string.format("[mame_sound_dump] %s device tag: %s", label, tag))
            return manager.machine.devices[tag]
        end
    end
    print(string.format("[mame_sound_dump] WARN: %s device not found (tried: %s)",
        label, table.concat(candidates, ", ")))
    return nil
end

local function hex_region(mem, addr, size)
    local parts = {}
    for i = 0, size - 1 do
        parts[i + 1] = string.format("%02x", mem:read_u8(addr + i))
    end
    return table.concat(parts)
end

local function hex_buffer(buf, size)
    local parts = {}
    for i = 0, size - 1 do
        parts[i + 1] = string.format("%02x", buf[i] & 0xff)
    end
    return table.concat(parts)
end

local function state_value(dev, key, default)
    if dev == nil or dev.state == nil then return default end
    local item = dev.state[key]
    if item == nil then return default end
    return item.value
end

local function reg6502()
    -- Canonical state item names for MAME's m6502 core (cpu/m6502/m6502.cpp).
    return {
        a  = state_value(audiocpu, "A", 0) & 0xff,
        x  = state_value(audiocpu, "X", 0) & 0xff,
        y  = state_value(audiocpu, "Y", 0) & 0xff,
        sp = state_value(audiocpu, "S", 0) & 0xff,
        p  = state_value(audiocpu, "P", 0) & 0xff,
        pc = state_value(audiocpu, "PC", 0) & 0xffff,
    }
end

local function mailbox_state()
    -- generic_latch_8 exposes m_latched_value (byte) and m_latch_read (true if
    -- already read = NOT pending; false if pending).
    local soundlatch_val = state_value(soundlatch, "m_latched_value", 0) & 0xff
    local soundlatch_read = state_value(soundlatch, "m_latch_read", 1)
    local mainlatch_val = state_value(mainlatch, "m_latched_value", 0) & 0xff
    local mainlatch_read = state_value(mainlatch, "m_latch_read", 1)
    return {
        soundlatch = soundlatch_val,
        mainlatch = mainlatch_val,
        pendingSound = (soundlatch_read == 0) and "true" or "false",
        pendingMain = (mainlatch_read == 0) and "true" or "false",
    }
end

local function install_taps()
    if audio_mem == nil then return end
    -- YM2151: the 6502 writes $1800 (address latch) and $1801 (data write for
    -- the selected register). Track the flow to maintain ym_shadow.
    if audio_mem.install_write_tap ~= nil then
        audio_mem:install_write_tap(0x1800, 0x1800, "ym_addr", function(o, d, m)
            ym_latched_reg = d & 0xff
        end)
        audio_mem:install_write_tap(0x1801, 0x1801, "ym_data", function(o, d, m)
            ym_shadow[ym_latched_reg] = d & 0xff
        end)
        -- POKEY: maps $1870-$187F onto the 6502 bus. Each byte is a register
        -- direct write; there is no separate address latch.
        audio_mem:install_write_tap(0x1870, 0x187f, "pokey_write", function(o, d, m)
            pokey_shadow[o - 0x1870] = d & 0xff
        end)
        print("[mame_sound_dump] write-tap installati su $1800/$1801 (YM2151) + $1870-$187F (POKEY)")
    else
        print("[mame_sound_dump] WARN: install_write_tap unavailable, YM/POKEY shadow registers remain 0")
    end
end

emu.register_frame_done(function()
    if audiocpu == nil then
        audiocpu = find_device({":audiocpu", ":audio_cpu", ":soundcpu"}, "audiocpu")
        if audiocpu ~= nil then
            audio_mem = audiocpu.spaces["program"]
        end
        ymsnd = find_device({":ymsnd", ":ym2151", ":ym"}, "ymsnd")
        pokey = find_device({":pokey", ":pokey1", ":pokey0"}, "pokey")
        soundlatch = find_device({":soundlatch", ":sound_latch"}, "soundlatch")
        mainlatch = find_device({":mainlatch", ":main_latch"}, "mainlatch")
        install_taps()
    end

    frame_count = frame_count + 1

    if frame_count == TARGET_FRAME then
        local regs = reg6502()
        local mbox = mailbox_state()

        local out = assert(io.open(OUT_PATH, "w"))
        out:write("{\n")
        out:write(string.format('  "frame": %d,\n', frame_count))
        out:write(string.format('  "audiocpu": {"a":%d,"x":%d,"y":%d,"sp":%d,"p":%d,"pc":%d},\n',
            regs.a, regs.x, regs.y, regs.sp, regs.p, regs.pc))
        out:write(string.format('  "audioRam": "%s",\n', hex_region(audio_mem, 0x0000, 0x1000)))
        out:write(string.format('  "mailbox": {"soundlatch":%d,"mainlatch":%d,"pendingSound":%s,"pendingMain":%s},\n',
            mbox.soundlatch, mbox.mainlatch, mbox.pendingSound, mbox.pendingMain))
        out:write(string.format('  "ym2151": "%s",\n', hex_buffer(ym_shadow, 256)))
        out:write(string.format('  "pokey": "%s"\n', hex_buffer(pokey_shadow, 16)))
        out:write("}\n")
        out:close()
        print(string.format("[mame_sound_dump] saved frame %d to %s", frame_count, OUT_PATH))
        manager.machine:exit()
    end
end)
