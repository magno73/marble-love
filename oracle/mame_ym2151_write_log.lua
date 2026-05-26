-- mame_ym2151_write_log.lua — log ogni (reg, val, cycle, pc) di write YM2151
-- in MAME. Pattern: write $1800 imposta selectedReg, write $1801 commit data.
-- Output JSON per diff con TS write log → identifica PRIMA divergenza.
local OUT_PATH = os.getenv("MARBLE_YM_OUT") or os.getenv("MARBLE_YM_TAP_OUT") or "/tmp/mame_ym_writes.json"
local TARGET_FRAME = tonumber(os.getenv("MARBLE_YM_TARGET") or "2000")
local COIN_FRAME = tonumber(os.getenv("MARBLE_SOUND_COIN_FRAME") or "1200")
local START_FRAME = tonumber(os.getenv("MARBLE_SOUND_START_FRAME") or "1500")
local PULSE_LEN = 15
local maincpu, main_mem
local audiocpu, sound_mem, ports
local frame_count = 0
local installed = false
local tap_handles = {}
local writes = {}
local selectedReg = 0
local MAX_WRITES = tonumber(os.getenv("MARBLE_YM_MAX_WRITES") or "20000")
local MUTE_POKEY = os.getenv("MARBLE_SOUND_MUTE_POKEY") == "1"

local function parse_int_env(name)
    local raw = os.getenv(name)
    if raw == nil or raw == "" then return nil end
    local hex = raw:match("^0[xX]([0-9a-fA-F]+)$")
    if hex ~= nil then return tonumber(hex, 16) end
    return tonumber(raw)
end

local INJECT_FRAME = parse_int_env("MARBLE_SOUND_INJECT_FRAME")
local INJECT_BYTE = parse_int_env("MARBLE_SOUND_INJECT_BYTE")
if (INJECT_FRAME == nil) ~= (INJECT_BYTE == nil) then
    error("[ym_writes] set both MARBLE_SOUND_INJECT_FRAME and MARBLE_SOUND_INJECT_BYTE")
end
local injections = {}
local function add_injection(frame, byte)
    table.insert(injections, { frame = math.floor(frame), byte = byte & 0xff, done = false })
end
if INJECT_FRAME ~= nil and INJECT_BYTE ~= nil then add_injection(INJECT_FRAME, INJECT_BYTE) end
local INJECT_START_FRAME = parse_int_env("MARBLE_SOUND_INJECT_START_FRAME")
if INJECT_START_FRAME ~= nil then
    local inject_spacing = parse_int_env("MARBLE_SOUND_INJECT_SPACING") or 30
    local inject_count = parse_int_env("MARBLE_SOUND_INJECT_COUNT") or 1
    local inject_first_byte = parse_int_env("MARBLE_SOUND_INJECT_FIRST_BYTE") or 0
    if inject_spacing < 1 then inject_spacing = 1 end
    if inject_count < 1 then inject_count = 1 end
    for i = 0, inject_count - 1 do
        add_injection(INJECT_START_FRAME + (i * inject_spacing), inject_first_byte + i)
    end
end
table.sort(injections, function(a, b)
    if a.frame == b.frame then return a.byte < b.byte end
    return a.frame < b.frame
end)

local function in_pulse(frame, start)
    return frame >= start and frame < (start + PULSE_LEN)
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

local function maybe_inject_sound_command()
    for _, injection in ipairs(injections) do
        if not injection.done and frame_count == injection.frame then
            if main_mem.write_u8 ~= nil then
                main_mem:write_u8(0xFE0001, injection.byte & 0xff)
            else
                main_mem:write_u16(0xFE0000, injection.byte & 0xff)
            end
            injection.done = true
            print(string.format("[ym_writes] injected cmd 0x%02x at frame %d",
                injection.byte & 0xff, frame_count))
        end
    end
end

local function record(reg, val, pc)
    if #writes >= MAX_WRITES then return end
    local t = manager.machine.time
    table.insert(writes, {
        reg = reg, val = val, pc = pc, frame = frame_count,
        secs = t.seconds, attos = t.attoseconds,
    })
end

emu.register_frame_done(function()
    if not installed then
        maincpu = manager.machine.devices[":maincpu"]
        main_mem = maincpu.spaces["program"]
        for _, t in ipairs({":audiocpu", ":soundcpu"}) do
            if manager.machine.devices[t] then audiocpu = manager.machine.devices[t]; break end
        end
        sound_mem = audiocpu.spaces["program"]
        ports = manager.machine.ioport.ports
        table.insert(tap_handles, main_mem:install_read_tap(0xF20000, 0xF20007, "ym_trackball",
            function(o, d, m) return d end))
        table.insert(tap_handles, main_mem:install_read_tap(0xF60000, 0xF60003, "ym_switches",
            function(o, d, m) return d end))
        table.insert(tap_handles, main_mem:install_read_tap(0xFC0000, 0xFC0001, "ym_response",
            function(o, d, m) return d end))
        table.insert(tap_handles, main_mem:install_read_tap(0xFE0000, 0xFE0001, "ym_cmd_r",
            function(o, d, m) return d end))
        table.insert(tap_handles, sound_mem:install_read_tap(0x1820, 0x1820, "ym_coin",
            function(o, d, m) return d end))
        -- YM is mirrored in the Atari System 1 sound map. Capture the broad
        -- mirrored range and filter with the same mask used by the older tap.
        table.insert(tap_handles, sound_mem:install_write_tap(0x1000, 0x3FFF, "ym_w",
            function(o, d, m)
                local masked = o & 0xD871
                if masked == 0x1800 then
                    selectedReg = d & 0xff
                elseif masked == 0x1801 then
                    record(selectedReg, d & 0xff, audiocpu.state["PC"].value)
                end
                local pokey_masked = o & 0xD87F
                if MUTE_POKEY and (pokey_masked & 0xfff0) == 0x1870 then
                    return 0
                end
                return d
            end))
        installed = true
        local inject_msg = #injections == 0
            and ""
            or string.format(" injections=%d first=f%d:0x%02x",
                #injections, injections[1].frame, injections[1].byte)
        print("[ym_writes] installed" .. inject_msg .. (MUTE_POKEY and " mutePOKEY=1" or ""))
    end
    frame_count = frame_count + 1
    apply_input(frame_count + 1)
    maybe_inject_sound_command()
    if frame_count >= TARGET_FRAME then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write("{")
        if INJECT_FRAME == nil or INJECT_BYTE == nil then
            out:write('"injectFrame": null, "injectByte": null, ')
        else
            out:write(string.format('"injectFrame": %d, "injectByte": "0x%02x", ',
                INJECT_FRAME, INJECT_BYTE & 0xff))
        end
        out:write('"injectSequence": [')
        for i, injection in ipairs(injections) do
            local sep = (i < #injections) and "," or ""
            out:write(string.format('{"frame":%d,"byte":"0x%02x","done":%s}%s',
                injection.frame, injection.byte & 0xff, injection.done and "true" or "false", sep))
        end
        out:write('], ')
        out:write("\"writes\":[\n")
        for i, w in ipairs(writes) do
            local sep = (i < #writes) and "," or ""
            out:write(string.format(
                '  {"reg":"0x%02x","val":"0x%02x","pc":"0x%04x","frame":%d,"secs":%d,"attos":"%s"}%s\n',
                w.reg, w.val, w.pc, w.frame, w.secs, tostring(w.attos), sep))
        end
        out:write("]}\n")
        out:close()
        print(string.format("[ym_writes] saved %d writes", #writes))
        manager.machine:exit()
    end
end)
