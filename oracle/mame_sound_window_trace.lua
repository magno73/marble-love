-- mame_sound_window_trace.lua — focused sound timing trace for cmd/NMI/YM drift.
--
-- Captures a small frame window with:
--   - main CPU writes to $FE0001 (sound command latch)
--   - main CPU writes to $860001 (bankselect / sound reset release)
--   - main CPU reads from $FC0001 (sound response ack)
--   - sound CPU reads from $1810 (command latch ack)
--   - sound CPU writes to $1810 (sound response post)
--   - YM2151 register writes ($1800/$1801 mirrors)
--   - POKEY writes ($1870-$187f mirrors)
--
-- Env:
--   MARBLE_SOUND_TRACE_FROM   first frame to record (default 372)
--   MARBLE_SOUND_TRACE_TO     last frame to record, inclusive (default 377)
--   MARBLE_SOUND_TRACE_OUT    output JSON
--   MARBLE_SOUND_TRACE_CMD_OUT optional same-run cmd-tape JSON output
--   MARBLE_SOUND_TRACE_STATUS_OUT optional same-run $1820 status-read JSON
--   MARBLE_SOUND_TRACE_STATUS_MAX_READS max full status reads (default 2000000)
--   MARBLE_SOUND_TRACE_STATUS_FULL 1 to include every status read
--   MARBLE_SOUND_COIN_FRAME   scripted coin pulse frame (default 1200)
--   MARBLE_SOUND_START_FRAME  scripted start pulse frame (default 1500)
--   MARBLE_SOUND_CPU_HZ       sound CPU clock for derived cycle fields
--                              (default 14.318181 MHz / 8)
--   MARBLE_SOUND_TRACE_PC     1 to record selected sound-ROM opcode fetches
--   MARBLE_SOUND_TRACE_PC_FULL 1 to record all sound-ROM opcode fetches
--   MARBLE_SOUND_TRACE_VECTORS 1 to record 6502 interrupt/reset vector reads
--   MARBLE_SOUND_TRACE_YM_STATUS 1 to record YM2151 status reads ($1800/$1801)
--   MARBLE_SOUND_TRACE_ZP     comma-separated zero-page addresses to trace
--   MARBLE_SOUND_TRACE_ZP_MODE read, write, or both (default both)
--   MARBLE_SOUND_TRACE_RAM    comma-separated sound RAM addresses to trace
--   MARBLE_SOUND_TRACE_RAM_MODE read, write, or both (default both)
--   MARBLE_SOUND_INJECT_FRAME / MARBLE_SOUND_INJECT_BYTE
--                              optional single forced cmd write
--   MARBLE_SOUND_INJECT_START_FRAME / MARBLE_SOUND_INJECT_SPACING /
--   MARBLE_SOUND_INJECT_COUNT / MARBLE_SOUND_INJECT_FIRST_BYTE
--                              optional forced cmd range, matching
--                              mame_sound_cmd_capture.lua

local FROM_FRAME = tonumber(os.getenv("MARBLE_SOUND_TRACE_FROM") or "372")
local TO_FRAME = tonumber(os.getenv("MARBLE_SOUND_TRACE_TO") or "377")
local OUT_PATH = os.getenv("MARBLE_SOUND_TRACE_OUT") or "/tmp/mame_sound_window_trace.json"
local CMD_OUT_PATH = os.getenv("MARBLE_SOUND_TRACE_CMD_OUT")
local STATUS_OUT_PATH = os.getenv("MARBLE_SOUND_TRACE_STATUS_OUT")
local STATUS_MAX_READS = tonumber(os.getenv("MARBLE_SOUND_TRACE_STATUS_MAX_READS") or "2000000")
local STATUS_FULL = os.getenv("MARBLE_SOUND_TRACE_STATUS_FULL") == "1"
local COIN_FRAME = tonumber(os.getenv("MARBLE_SOUND_COIN_FRAME") or "1200")
local START_FRAME = tonumber(os.getenv("MARBLE_SOUND_START_FRAME") or "1500")
local SOUND_CPU_HZ = tonumber(os.getenv("MARBLE_SOUND_CPU_HZ") or "1789772.625")
local TRACE_PC_FULL = os.getenv("MARBLE_SOUND_TRACE_PC_FULL") == "1"
local TRACE_PC = os.getenv("MARBLE_SOUND_TRACE_PC") == "1" or TRACE_PC_FULL
local TRACE_VECTORS = os.getenv("MARBLE_SOUND_TRACE_VECTORS") == "1"
local TRACE_YM_STATUS = os.getenv("MARBLE_SOUND_TRACE_YM_STATUS") == "1"
local TRACE_ZP_MODE = os.getenv("MARBLE_SOUND_TRACE_ZP_MODE") or "both"
local TRACE_RAM_MODE = os.getenv("MARBLE_SOUND_TRACE_RAM_MODE") or "both"
local PULSE_LEN = 15

local maincpu, main_mem
local audiocpu, sound_mem
local ports
local frame_count = 0
local installed = false
local selected_reg = 0
local events = {}
local cmds = {}
local sound_cmd_reads = {}
local next_sound_cmd_read_source = 1
local main_reply_reads = {}
local main_reply_read_count = 0
local status_reads = {}
local status_base_runs = {}
local status_read_count = 0
local frame_start_time = {}
local tap_handles = {}
local last_sound_fetch = nil

local function in_pulse(frame, start)
    return frame >= start and frame < (start + PULSE_LEN)
end

local function parse_int_env(name)
    local raw = os.getenv(name)
    if raw == nil or raw == "" then return nil end
    local hex = raw:match("^0[xX]([0-9a-fA-F]+)$")
    if hex ~= nil then return tonumber(hex, 16) end
    return tonumber(raw)
end

local function parse_int_value(raw)
    if raw == nil or raw == "" then return nil end
    local hex = raw:match("^0[xX]([0-9a-fA-F]+)$")
    if hex ~= nil then return tonumber(hex, 16) end
    return tonumber(raw)
end

local trace_zp = {}
local trace_zp_count = 0
local trace_zp_reads = TRACE_ZP_MODE == "both" or TRACE_ZP_MODE == "read"
local trace_zp_writes = TRACE_ZP_MODE == "both" or TRACE_ZP_MODE == "write"
if not trace_zp_reads and not trace_zp_writes then
    error("[sound_window_trace] unsupported MARBLE_SOUND_TRACE_ZP_MODE: " .. TRACE_ZP_MODE)
end
local trace_ram = {}
local trace_ram_count = 0
local trace_ram_reads = TRACE_RAM_MODE == "both" or TRACE_RAM_MODE == "read"
local trace_ram_writes = TRACE_RAM_MODE == "both" or TRACE_RAM_MODE == "write"
if not trace_ram_reads and not trace_ram_writes then
    error("[sound_window_trace] unsupported MARBLE_SOUND_TRACE_RAM_MODE: " .. TRACE_RAM_MODE)
end
local trace_zp_raw = os.getenv("MARBLE_SOUND_TRACE_ZP") or ""
for part in string.gmatch(trace_zp_raw, "([^,]+)") do
    local value = parse_int_value((part:gsub("^%s+", ""):gsub("%s+$", "")))
    if value ~= nil then
        local addr = value & 0xff
        if trace_zp[addr] ~= true then
            trace_zp[addr] = true
            trace_zp_count = trace_zp_count + 1
        end
    end
end
local trace_ram_raw = os.getenv("MARBLE_SOUND_TRACE_RAM") or ""
for part in string.gmatch(trace_ram_raw, "([^,]+)") do
    local value = parse_int_value((part:gsub("^%s+", ""):gsub("%s+$", "")))
    if value ~= nil and value >= 0 and value < 0x1000 then
        local addr = value & 0x0fff
        if trace_ram[addr] ~= true then
            trace_ram[addr] = true
            trace_ram_count = trace_ram_count + 1
        end
    end
end

local injections = {}

local function add_injection(frame, byte)
    table.insert(injections, {
        frame = math.floor(frame),
        byte = byte & 0xff,
        done = false,
    })
end

local INJECT_FRAME = parse_int_env("MARBLE_SOUND_INJECT_FRAME")
local INJECT_BYTE = parse_int_env("MARBLE_SOUND_INJECT_BYTE")
if (INJECT_FRAME == nil) ~= (INJECT_BYTE == nil) then
    error("[sound_window_trace] set both MARBLE_SOUND_INJECT_FRAME and MARBLE_SOUND_INJECT_BYTE")
end
if INJECT_FRAME ~= nil and INJECT_BYTE ~= nil then
    add_injection(INJECT_FRAME, INJECT_BYTE)
end

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

local function in_window()
    return frame_count >= FROM_FRAME and frame_count <= TO_FRAME
end

local function timestamp()
    local t = manager.machine.time
    return t.seconds, tostring(t.attoseconds)
end

local function timestamp_seconds(secs, attos)
    return secs + (tonumber(attos) / 1000000000000000000.0)
end

local function current_video_cycle_in_frame(secs, attos)
    local start = frame_start_time[frame_count]
    if start == nil then return nil end
    return math.floor(((timestamp_seconds(secs, attos) - start) * SOUND_CPU_HZ) + 0.5)
end

local function record(kind, fields)
    if not in_window() then return end
    local secs, attos = timestamp()
    fields.kind = kind
    fields.frame = frame_count
    fields.secs = secs
    fields.attos = attos
    fields.time_seconds = timestamp_seconds(secs, attos)
    table.insert(events, fields)
    return fields
end

local function attach_last_sound_fetch(fields)
    if last_sound_fetch == nil then return end
    fields.instFrame = last_sound_fetch.frame
    fields.instPc = last_sound_fetch.pc
    fields.instOpcode = last_sound_fetch.opcode
    fields.instSecs = last_sound_fetch.secs
    fields.instAttos = last_sound_fetch.attos
    fields.instTimeSeconds = last_sound_fetch.time_seconds
end

local function apply_input(frame)
    if ports == nil then return end
    local coin_port = ports[":1820"]
    if coin_port and coin_port.fields["Coin 1"] then
        -- Lua field values are logical field activation values. Coin 1 is
        -- IP_ACTIVE_LOW in the driver, so 1 means pressed and 0 means released.
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
            print(string.format("[sound_window_trace] injected cmd 0x%02x at frame %d",
                injection.byte & 0xff, frame_count))
        end
    end
end

local function hex_or_unknown(value, width)
    if value == nil or value < 0 then return '"-1"' end
    return string.format('"0x%0' .. tostring(width) .. 'x"', value)
end

local function sound_cpu_state_fields()
    if audiocpu == nil then return {} end
    return {
        a = audiocpu.state["A"] and audiocpu.state["A"].value or -1,
        x = audiocpu.state["X"] and audiocpu.state["X"].value or -1,
        y = audiocpu.state["Y"] and audiocpu.state["Y"].value or -1,
        p = audiocpu.state["P"] and audiocpu.state["P"].value or -1,
        sp = audiocpu.state["SP"] and audiocpu.state["SP"].value or -1,
        curpc = audiocpu.state["CURPC"] and audiocpu.state["CURPC"].value or -1,
        genpc = audiocpu.state["GENPC"] and audiocpu.state["GENPC"].value or -1,
        ir = audiocpu.state["IR"] and audiocpu.state["IR"].value or -1,
    }
end

local function should_trace_pc(pc)
    if TRACE_PC_FULL then return pc >= 0x8000 and pc <= 0xffff end
    return (pc >= 0x8100 and pc <= 0x81c3) or
        (pc >= 0x8240 and pc <= 0x8280) or
        (pc >= 0x8e20 and pc <= 0x8ec0) or
        (pc >= 0x81e8 and pc <= 0x820f) or
        (pc >= 0xe4e5 and pc <= 0xe543) or
        (pc >= 0x9560 and pc <= 0x95d0) or
        pc == 0x900a
end

local function vector_name(addr)
    if addr == 0xfffa or addr == 0xfffb then return "nmi" end
    if addr == 0xfffc or addr == 0xfffd then return "reset" end
    if addr == 0xfffe or addr == 0xffff then return "irq" end
    return "unknown"
end

local function install_taps()
    maincpu = manager.machine.devices[":maincpu"]
    main_mem = maincpu.spaces["program"]
    for _, tag in ipairs({":audiocpu", ":soundcpu"}) do
        if manager.machine.devices[tag] then audiocpu = manager.machine.devices[tag]; break end
    end
    sound_mem = audiocpu.spaces["program"]
    ports = manager.machine.ioport.ports

    -- Observational reads keep this scenario aligned with the command capture
    -- scripts, which otherwise do not always produce the same attract cmd flow.
    table.insert(tap_handles, main_mem:install_read_tap(0xF20000, 0xF20007, "snd_win_trackball",
        function(o, d, m) return d end))
    table.insert(tap_handles, main_mem:install_read_tap(0xF60000, 0xF60003, "snd_win_switches",
        function(o, d, m) return d end))
    table.insert(tap_handles, main_mem:install_read_tap(0xFC0000, 0xFC0001, "snd_win_response",
        function(o, d, m)
            main_reply_read_count = main_reply_read_count + 1
            if CMD_OUT_PATH ~= nil and CMD_OUT_PATH ~= "" then
                local secs, attos = timestamp()
                table.insert(main_reply_reads, {
                    frame = frame_count,
                    val = d & 0xff,
                    pc = maincpu.state["PC"] and maincpu.state["PC"].value or -1,
                    mask = m & 0xffff,
                    secs = secs,
                    attos = attos,
                })
            end
            if in_window() then
                record("mainReplyRead", {
                    pc = maincpu.state["PC"] and maincpu.state["PC"].value or -1,
                    addr = o,
                    val = d & 0xff,
                    mask = m & 0xffff,
                })
            end
            return d
        end))
    table.insert(tap_handles, main_mem:install_read_tap(0xFE0000, 0xFE0001, "snd_win_cmd_r",
        function(o, d, m) return d end))
    table.insert(tap_handles, sound_mem:install_read_tap(0x1820, 0x1820, "snd_win_coin",
        function(o, d, m)
            if STATUS_OUT_PATH ~= nil and STATUS_OUT_PATH ~= "" then
                local secs, attos = timestamp()
                local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
                local val = d & 0xff
                local base = val & 0xe7
                local run = status_base_runs[#status_base_runs]
                if run == nil or run.base ~= base then
                    table.insert(status_base_runs, {
                        start = status_read_count,
                        count = 1,
                        base = base,
                        val = val,
                        first_frame = frame_count,
                        first_pc = pc,
                    })
                else
                    run.count = run.count + 1
                end
                if STATUS_FULL and #status_reads < STATUS_MAX_READS then
                    table.insert(status_reads, {
                        frame = frame_count,
                        val = val,
                        pc = pc,
                        secs = secs,
                        attos = attos,
                    })
                end
                status_read_count = status_read_count + 1
            end
            if TRACE_PC and in_window() then
                local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
                local fields = sound_cpu_state_fields()
                fields.pc = pc
                fields.addr = o
                fields.val = d & 0xff
                record("statusRead", fields)
            end
            return d
        end))
    table.insert(tap_handles, sound_mem:install_write_tap(0x1820, 0x1827, "snd_win_latch_write",
        function(o, d, m)
            if in_window() then
                local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
                local fields = sound_cpu_state_fields()
                fields.pc = pc
                fields.addr = o
                fields.val = d & 0xff
                fields.mask = m & 0xffff
                record("latchWrite", fields)
            end
        end))
    if TRACE_YM_STATUS then
        table.insert(tap_handles, sound_mem:install_read_tap(0x1800, 0x1801, "snd_win_ym_status",
            function(o, d, m)
                if in_window() then
                    local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
                    local fields = sound_cpu_state_fields()
                    fields.pc = pc
                    fields.addr = o
                    fields.val = d & 0xff
                    record("ymStatusRead", fields)
                end
                return d
            end))
    end

    if trace_zp_count > 0 and trace_zp_reads then
        table.insert(tap_handles, sound_mem:install_read_tap(0x0000, 0x00ff, "snd_win_zp_read",
            function(o, d, m)
                if in_window() and trace_zp[o & 0xff] then
                    local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
                    local fields = sound_cpu_state_fields()
                    fields.pc = pc
                    fields.addr = o & 0xff
                    fields.val = d & 0xff
                    record("zpRead", fields)
                end
                return d
            end))
    end
    if trace_zp_count > 0 and trace_zp_writes then
        table.insert(tap_handles, sound_mem:install_write_tap(0x0000, 0x00ff, "snd_win_zp_write",
            function(o, d, m)
                if in_window() and trace_zp[o & 0xff] then
                    local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
                    local fields = sound_cpu_state_fields()
                    fields.pc = pc
                    fields.addr = o & 0xff
                    fields.val = d & 0xff
                    record("zpWrite", fields)
                end
            end))
    end
    if trace_ram_count > 0 and trace_ram_reads then
        table.insert(tap_handles, sound_mem:install_read_tap(0x0000, 0x0fff, "snd_win_ram_read",
            function(o, d, m)
                if in_window() and trace_ram[o & 0x0fff] then
                    local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
                    local fields = sound_cpu_state_fields()
                    fields.pc = pc
                    fields.addr = o & 0x0fff
                    fields.val = d & 0xff
                    record("ramRead", fields)
                end
                return d
            end))
    end
    if trace_ram_count > 0 and trace_ram_writes then
        table.insert(tap_handles, sound_mem:install_write_tap(0x0000, 0x0fff, "snd_win_ram_write",
            function(o, d, m)
                if in_window() and trace_ram[o & 0x0fff] then
                    local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
                    local fields = sound_cpu_state_fields()
                    fields.pc = pc
                    fields.addr = o & 0x0fff
                    fields.val = d & 0xff
                    record("ramWrite", fields)
                end
            end))
    end

    if TRACE_PC then
        table.insert(tap_handles, sound_mem:install_read_tap(0x8000, 0xffff, "snd_win_pc_fetch",
            function(o, d, m)
                if in_window() then
                    local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
                    if pc == o and should_trace_pc(pc) then
                        local fields = sound_cpu_state_fields()
                        fields.pc = pc
                        fields.opcode = d & 0xff
                        local recorded = record("pcFetch", fields)
                        if recorded ~= nil then
                            last_sound_fetch = {
                                frame = recorded.frame,
                                secs = recorded.secs,
                                attos = recorded.attos,
                                time_seconds = recorded.time_seconds,
                                pc = pc,
                                opcode = d & 0xff,
                            }
                        end
                    end
                end
                return d
            end))
    end

    if TRACE_VECTORS then
        table.insert(tap_handles, sound_mem:install_read_tap(0xfffa, 0xffff, "snd_win_vector_read",
            function(o, d, m)
                if in_window() then
                    local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
                    local fields = sound_cpu_state_fields()
                    fields.pc = pc
                    fields.addr = o
                    fields.val = d & 0xff
                    fields.vector = vector_name(o)
                    record("vectorRead", fields)
                end
                return d
            end))
    end

    table.insert(tap_handles, main_mem:install_write_tap(0xFE0000, 0xFE0001, "snd_win_cmd_w",
        function(o, d, m)
            if (m & 0xff) ~= 0 then
                local secs, attos = timestamp()
                local pc = maincpu.state["PC"] and maincpu.state["PC"].value or -1
                local sound_pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
                table.insert(cmds, {
                    frame = frame_count,
                    byte = d & 0xff,
                    secs = secs,
                    attos = attos,
                    cycleInFrame = current_video_cycle_in_frame(secs, attos),
                    soundPc = sound_pc,
                    soundA = audiocpu.state["A"] and audiocpu.state["A"].value or -1,
                    soundX = audiocpu.state["X"] and audiocpu.state["X"].value or -1,
                    soundY = audiocpu.state["Y"] and audiocpu.state["Y"].value or -1,
                    soundP = audiocpu.state["P"] and audiocpu.state["P"].value or -1,
                    soundSp = audiocpu.state["SP"] and audiocpu.state["SP"].value or -1,
                })
                if in_window() then
                    record("mainCmdWrite", {
                        pc = pc,
                        soundPc = sound_pc,
                        addr = o,
                        val = d & 0xff,
                        mask = m & 0xffff,
                    })
                end
            end
            return d
        end))

    table.insert(tap_handles, main_mem:install_write_tap(0x860000, 0x860001, "snd_win_bank_w",
        function(o, d, m)
            if in_window() and (m & 0xff) ~= 0 then
                local pc = maincpu.state["PC"] and maincpu.state["PC"].value or -1
                local sound_pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
                record("bankWrite", {
                    pc = pc,
                    soundPc = sound_pc,
                    addr = o,
                    val = d & 0xff,
                    mask = m & 0xffff,
                })
            end
            return d
        end))

    table.insert(tap_handles, sound_mem:install_read_tap(0x1810, 0x1810, "snd_win_cmd_read",
        function(o, d, m)
            if in_window() then
                local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
                local t = manager.machine.time
                local secs = t.seconds
                local attos = tostring(t.attoseconds)
                local command = cmds[next_sound_cmd_read_source]
                local source_index = command == nil and -1 or (next_sound_cmd_read_source - 1)
                local byte = d & 0xff
                if command ~= nil then
                    byte = command.byte & 0xff
                    next_sound_cmd_read_source = next_sound_cmd_read_source + 1
                end
                table.insert(sound_cmd_reads, {
                    frame = frame_count,
                    sourceIndex = source_index,
                    byte = byte,
                    val = d & 0xff,
                    pc = pc,
                    secs = secs,
                    attos = attos,
                    cycleInFrame = current_video_cycle_in_frame(secs, attos),
                })
                record("cmdRead", {
                    pc = pc,
                    addr = o,
                    val = d & 0xff,
                })
            end
            return d
        end))

    table.insert(tap_handles, sound_mem:install_write_tap(0x1810, 0x1810, "snd_win_reply_write",
        function(o, d, m)
            if in_window() then
                local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
                local fields = sound_cpu_state_fields()
                fields.pc = pc
                fields.addr = o
                fields.val = d & 0xff
                record("replyWrite", fields)
            end
            return d
        end))

    table.insert(tap_handles, sound_mem:install_write_tap(0x1000, 0x3FFF, "snd_win_ym_w",
        function(o, d, m)
            local masked = o & 0xD871
            if masked == 0x1800 then
                selected_reg = d & 0xff
            elseif masked == 0x1801 and in_window() then
                local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
                local fields = {
                    pc = pc,
                    reg = selected_reg,
                    val = d & 0xff,
                }
                attach_last_sound_fetch(fields)
                record("ymWrite", fields)
            end
            return d
        end))

    table.insert(tap_handles, sound_mem:install_write_tap(0x1000, 0x3FFF, "snd_win_pokey_w",
        function(o, d, m)
            local masked = o & 0xD87F
            if in_window() and (masked & 0xFFF0) == 0x1870 then
                local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
                local fields = {
                    pc = pc,
                    reg = o & 0x0f,
                    val = d & 0xff,
                }
                attach_last_sound_fetch(fields)
                record("pokeyWrite", fields)
            end
            return d
        end))
end

local function write_reply_read_json(out, r, sep)
    out:write(string.format(
        '    {"frame": %d, "val": "0x%02x", "pc": "0x%04x", "mask": "0x%04x", "secs": %d, "attos": "%s"}%s\n',
        r.frame, r.val, r.pc, r.mask, r.secs or 0, r.attos or "0", sep))
end

local function write_sound_cmd_read_json(out, r, sep)
    out:write(string.format('    {"frame": %d, "sourceIndex": %d, "byte": %d, "val": "0x%02x", "pc": "0x%04x", "secs": %d, "attos": "%s"',
        r.frame, r.sourceIndex, r.byte, r.val, r.pc, r.secs or 0, r.attos or "0"))
    if r.cycleInFrame ~= nil then out:write(string.format(', "cycleInFrame": %d', r.cycleInFrame)) end
    out:write(string.format('}%s\n', sep))
end

local function write_cmd_tape_json()
    if CMD_OUT_PATH == nil or CMD_OUT_PATH == "" then return end
    local out = assert(io.open(CMD_OUT_PATH, "w"))
    out:write("{\n")
    out:write(string.format('  "frame": %d,\n', frame_count))
    out:write(string.format('  "coinFrame": %d,\n', COIN_FRAME))
    out:write(string.format('  "startFrame": %d,\n', START_FRAME))
    out:write('  "injectSequence": [\n')
    for i, injection in ipairs(injections) do
        local sep = (i < #injections) and "," or ""
        out:write(string.format(
            '    {"frame": %d, "byte": "0x%02x", "done": %s}%s\n',
            injection.frame, injection.byte & 0xff, injection.done and "true" or "false", sep))
    end
    out:write("  ],\n")
    out:write(string.format('  "mainReplyReads": %d,\n', main_reply_read_count))
    out:write('  "replyAcks": [\n')
    for i, r in ipairs(main_reply_reads) do
        local sep = (i < #main_reply_reads) and "," or ""
        write_reply_read_json(out, r, sep)
    end
    out:write("  ],\n")
    out:write(string.format('  "soundCmdReadCount": %d,\n', #sound_cmd_reads))
    out:write('  "soundCmdReads": [\n')
    for i, r in ipairs(sound_cmd_reads) do
        local sep = (i < #sound_cmd_reads) and "," or ""
        write_sound_cmd_read_json(out, r, sep)
    end
    out:write("  ],\n")
    out:write(string.format('  "count": %d,\n', #cmds))
    out:write('  "cmds": [\n')
    for i, c in ipairs(cmds) do
        local sep = (i < #cmds) and "," or ""
        out:write(string.format('    {"frame": %d, "byte": %d, "secs": %d, "attos": "%s"',
            c.frame, c.byte, c.secs or 0, c.attos or "0"))
        if c.cycleInFrame ~= nil then out:write(string.format(', "cycleInFrame": %d', c.cycleInFrame)) end
        if c.soundPc ~= nil then out:write(string.format(', "soundPc": "0x%04x"', c.soundPc)) end
        if c.soundA ~= nil then out:write(string.format(', "soundA": "0x%02x"', c.soundA)) end
        if c.soundX ~= nil then out:write(string.format(', "soundX": "0x%02x"', c.soundX)) end
        if c.soundY ~= nil then out:write(string.format(', "soundY": "0x%02x"', c.soundY)) end
        if c.soundP ~= nil then out:write(string.format(', "soundP": "0x%02x"', c.soundP)) end
        if c.soundSp ~= nil then out:write(string.format(', "soundSp": "0x%02x"', c.soundSp)) end
        out:write(string.format('}%s\n', sep))
    end
    out:write("  ]\n")
    out:write("}\n")
    out:close()
    print(string.format("[sound_window_trace] saved same-run cmd tape with %d cmds and %d reply reads to %s",
        #cmds, main_reply_read_count, CMD_OUT_PATH))
end

local function write_status_json()
    if STATUS_OUT_PATH == nil or STATUS_OUT_PATH == "" then return end
    local out = assert(io.open(STATUS_OUT_PATH, "w"))
    out:write("{\n")
    out:write(string.format('  "frame": %d,\n', frame_count))
    out:write(string.format('  "coinFrame": %d,\n', COIN_FRAME))
    out:write(string.format('  "startFrame": %d,\n', START_FRAME))
    out:write(string.format('  "statusReadCount": %d,\n', status_read_count))
    out:write('  "statusBaseRuns": [\n')
    for i, r in ipairs(status_base_runs) do
        local sep = (i < #status_base_runs) and "," or ""
        out:write(string.format(
            '    {"start": %d, "count": %d, "base": "0x%02x", "val": "0x%02x", "firstFrame": %d, "firstPc": "0x%04x"}%s\n',
            r.start, r.count, r.base, r.val, r.first_frame, r.first_pc, sep))
    end
    out:write("  ]")
    if STATUS_FULL then
        out:write(',\n  "statusReads": [\n')
        for i, r in ipairs(status_reads) do
            local sep = (i < #status_reads) and "," or ""
            out:write(string.format(
                '    {"frame": %d, "val": "0x%02x", "pc": "0x%04x", "secs": %d, "attos": "%s"}%s\n',
                r.frame, r.val, r.pc, r.secs or 0, r.attos or "0", sep))
        end
        out:write("  ]\n")
    else
        out:write("\n")
    end
    out:write("}\n")
    out:close()
    print(string.format("[sound_window_trace] saved same-run status tape with %d reads (%d base runs) to %s",
        status_read_count, #status_base_runs, STATUS_OUT_PATH))
end

local function write_json()
    local trace_origin_time = nil
    local frame_origin_time = {}
    for _, e in ipairs(events) do
        if trace_origin_time == nil then trace_origin_time = e.time_seconds end
        if e.kind == "mainCmdWrite" and frame_origin_time[e.frame] == nil then
            frame_origin_time[e.frame] = e.time_seconds
        end
    end

    local out = assert(io.open(OUT_PATH, "w"))
    out:write("{\n")
    out:write(string.format('  "fromFrame": %d,\n', FROM_FRAME))
    out:write(string.format('  "toFrame": %d,\n', TO_FRAME))
    out:write(string.format('  "soundCpuHz": %.9f,\n', SOUND_CPU_HZ))
    out:write('  "injectSequence": [\n')
    for i, injection in ipairs(injections) do
        local sep = (i < #injections) and "," or ""
        out:write(string.format(
            '    {"frame": %d, "byte": "0x%02x", "done": %s}%s\n',
            injection.frame, injection.byte & 0xff, injection.done and "true" or "false", sep))
    end
    out:write("  ],\n")
    out:write(string.format('  "eventCount": %d,\n', #events))
    out:write('  "events": [\n')
    for i, e in ipairs(events) do
        local sep = (i < #events) and "," or ""
        out:write("    {")
        out:write(string.format('"kind":"%s","frame":%d,"secs":%d,"attos":"%s"', e.kind, e.frame, e.secs, e.attos))
        if trace_origin_time ~= nil then
            local rel_cycle = math.floor(((e.time_seconds - trace_origin_time) * SOUND_CPU_HZ) + 0.5)
            out:write(string.format(',"relativeCycle":%d', rel_cycle))
        end
        if frame_start_time[e.frame] ~= nil then
            local video_cycle_in_frame = math.floor(((e.time_seconds - frame_start_time[e.frame]) * SOUND_CPU_HZ) + 0.5)
            out:write(string.format(',"cycleInFrame":%d', video_cycle_in_frame))
            out:write(string.format(',"videoCycleInFrame":%d', video_cycle_in_frame))
        end
        if frame_origin_time[e.frame] ~= nil then
            local command_relative_cycle = math.floor(((e.time_seconds - frame_origin_time[e.frame]) * SOUND_CPU_HZ) + 0.5)
            out:write(string.format(',"commandRelativeCycleInFrame":%d', command_relative_cycle))
        end
        if e.pc ~= nil then out:write(string.format(',"pc":%s', hex_or_unknown(e.pc, 4))) end
        if e.a ~= nil then out:write(string.format(',"a":%s', hex_or_unknown(e.a, 2))) end
        if e.x ~= nil then out:write(string.format(',"x":%s', hex_or_unknown(e.x, 2))) end
        if e.y ~= nil then out:write(string.format(',"y":%s', hex_or_unknown(e.y, 2))) end
        if e.p ~= nil then out:write(string.format(',"p":%s', hex_or_unknown(e.p, 2))) end
        if e.sp ~= nil then out:write(string.format(',"sp":%s', hex_or_unknown(e.sp, 2))) end
        if e.curpc ~= nil then out:write(string.format(',"curpc":%s', hex_or_unknown(e.curpc, 4))) end
        if e.genpc ~= nil then out:write(string.format(',"genpc":%s', hex_or_unknown(e.genpc, 4))) end
        if e.ir ~= nil then out:write(string.format(',"ir":"0x%02x"', e.ir & 0xff)) end
        if e.opcode ~= nil then out:write(string.format(',"opcode":"0x%02x"', e.opcode & 0xff)) end
        if e.vector ~= nil then out:write(string.format(',"vector":"%s"', e.vector)) end
        if e.instFrame ~= nil then out:write(string.format(',"instFrame":%d', e.instFrame)) end
        if e.instPc ~= nil then out:write(string.format(',"instPc":%s', hex_or_unknown(e.instPc, 4))) end
        if e.instOpcode ~= nil then out:write(string.format(',"instOpcode":"0x%02x"', e.instOpcode & 0xff)) end
        if e.instFrame ~= nil and e.instTimeSeconds ~= nil and frame_start_time[e.instFrame] ~= nil then
            local inst_cycle = math.floor(((e.instTimeSeconds - frame_start_time[e.instFrame]) * SOUND_CPU_HZ) + 0.5)
            out:write(string.format(',"instFetchVideoCycleInFrame":%d', inst_cycle))
        end
        if e.instTimeSeconds ~= nil then
            local inst_delta = math.floor(((e.time_seconds - e.instTimeSeconds) * SOUND_CPU_HZ) + 0.5)
            out:write(string.format(',"instDeltaCycles":%d', inst_delta))
        end
        if e.soundPc ~= nil then out:write(string.format(',"soundPc":%s', hex_or_unknown(e.soundPc, 4))) end
        if e.addr ~= nil then out:write(string.format(',"addr":%s', hex_or_unknown(e.addr, 4))) end
        if e.reg ~= nil then out:write(string.format(',"reg":"0x%02x"', e.reg)) end
        if e.val ~= nil then out:write(string.format(',"val":"0x%02x"', e.val)) end
        if e.mask ~= nil then out:write(string.format(',"mask":"0x%04x"', e.mask)) end
        out:write("}" .. sep .. "\n")
    end
    out:write("  ]\n")
    out:write("}\n")
    out:close()
end

emu.register_frame_done(function()
    if not installed then
        install_taps()
        installed = true
        print(string.format("[sound_window_trace] installed window=%d..%d injections=%d",
            FROM_FRAME, TO_FRAME, #injections))
    end
    frame_count = frame_count + 1
    local secs, attos = timestamp()
    frame_start_time[frame_count] = timestamp_seconds(secs, attos)
    apply_input(frame_count + 1)
    maybe_inject_sound_command()

    if frame_count > TO_FRAME then
        write_json()
        write_cmd_tape_json()
        write_status_json()
        print(string.format("[sound_window_trace] saved %d events to %s", #events, OUT_PATH))
        manager.machine:exit()
    end
end)
