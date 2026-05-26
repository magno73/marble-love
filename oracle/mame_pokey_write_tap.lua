local TARGET_FRAME = tonumber(os.getenv("MARBLE_POKEY_TARGET") or "14000")
local OUT_PATH = os.getenv("MARBLE_POKEY_OUT") or "/tmp/mame_pokey_writes.json"
local YM_OUT_PATH = os.getenv("MARBLE_YM_OUT") or os.getenv("MARBLE_YM_TAP_OUT")
local CMD_OUT_PATH = os.getenv("MARBLE_SOUND_CMD_OUT")
local STATUS_OUT_PATH = os.getenv("MARBLE_SOUND_STATUS_OUT")
local EMBED_REPLY_IN_CMD = os.getenv("MARBLE_SOUND_CMD_EMBED_REPLY") == "1"
local STATUS_MAX_READS = tonumber(os.getenv("MARBLE_SOUND_STATUS_MAX_READS") or "2000000")
local STATUS_FULL = os.getenv("MARBLE_SOUND_STATUS_FULL") == "1"
local SOUND_CPU_HZ = tonumber(os.getenv("MARBLE_SOUND_CPU_HZ") or "1789772.625")
local SOUND_CYCLES_PER_FRAME = tonumber(os.getenv("MARBLE_SOUND_CYCLES_PER_FRAME") or "29868")
local TRACE_FETCH = os.getenv("MARBLE_SOUND_TRACE_FETCH") == "1"
local TRACE_FETCH_FROM = tonumber(os.getenv("MARBLE_SOUND_TRACE_FETCH_FROM") or "0")
local TRACE_FETCH_TO = tonumber(os.getenv("MARBLE_SOUND_TRACE_FETCH_TO") or tostring(TARGET_FRAME))
-- Diagnostics-only: mute YM key-on writes while preserving YM timer/control
-- writes, producing a cleaner POKEY PCM oracle when combined with -wavwrite.
local MUTE_YM = os.getenv("MARBLE_SOUND_MUTE_YM") == "1"
local COIN_FRAME = tonumber(os.getenv("MARBLE_SOUND_COIN_FRAME") or "1200")
local START_FRAME = tonumber(os.getenv("MARBLE_SOUND_START_FRAME") or "1500")
local PULSE_LEN = 15
local maincpu, main_mem, audiocpu, sound_mem, ports
local frame_count = 0
local installed = false
local tap_handles = {}
local writes = {}
local ym_writes = {}
local cmds = {}
local sound_cmd_reads = {}
local status_reads = {}
local status_base_runs = {}
local status_read_count = 0
local main_reply_reads = {}
local selected_ym_reg = 0
local cmd_frame_origin_seconds = {}
local frame_start_seconds = {}
local last_sound_fetch = nil
local pending_next_fetch_events = {}
local pending_sound_cmd_indices = {}
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
    error("[pokey] set both MARBLE_SOUND_INJECT_FRAME and MARBLE_SOUND_INJECT_BYTE")
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
local function in_pulse(f, s) return f >= s and f < s + PULSE_LEN end
local function timestamp_seconds(t)
    return t.seconds + (tonumber(t.attoseconds) / 1000000000000000000.0)
end
local function current_cycle_in_frame(seconds)
    local start = frame_start_seconds[frame_count]
    if start == nil then return nil end
    return math.floor(((seconds - start) * SOUND_CPU_HZ) + 0.5)
end
local function attach_cycle_fields(event)
    local cycle_in_frame = current_cycle_in_frame(event.seconds)
    if cycle_in_frame == nil then return end
    event.cycleInFrame = cycle_in_frame
    event.cycle = math.floor((event.frame * SOUND_CYCLES_PER_FRAME) + cycle_in_frame)
end
local function should_trace_fetch()
    return TRACE_FETCH and frame_count >= TRACE_FETCH_FROM and frame_count <= TRACE_FETCH_TO
end
local function attach_last_sound_fetch(event)
    if last_sound_fetch == nil then return end
    event.instFrame = last_sound_fetch.frame
    event.instPc = last_sound_fetch.pc
    event.instOpcode = last_sound_fetch.opcode
    event.instSecs = last_sound_fetch.secs
    event.instAttos = last_sound_fetch.attos
    event.instDeltaCycles = math.floor(((event.seconds - last_sound_fetch.seconds) * SOUND_CPU_HZ) + 0.5)
end
local function attach_next_sound_fetch_to_pending(fetch)
    if #pending_next_fetch_events == 0 then return end
    local remaining = {}
    for _, event in ipairs(pending_next_fetch_events) do
        local delta_cycles = math.floor(((fetch.seconds - event.seconds) * SOUND_CPU_HZ) + 0.5)
        if event.nextInstPc == nil then
            event.nextInstFrame = fetch.frame
            event.nextInstPc = fetch.pc
            event.nextInstOpcode = fetch.opcode
            event.nextInstSecs = fetch.secs
            event.nextInstAttos = fetch.attos
            event.nextInstDeltaCycles = delta_cycles
        end
        if delta_cycles >= 0 and event.nextChronoInstPc == nil then
            event.nextChronoInstFrame = fetch.frame
            event.nextChronoInstPc = fetch.pc
            event.nextChronoInstOpcode = fetch.opcode
            event.nextChronoInstSecs = fetch.secs
            event.nextChronoInstAttos = fetch.attos
            event.nextChronoInstDeltaCycles = delta_cycles
        end
        if event.nextChronoInstPc == nil then table.insert(remaining, event) end
    end
    pending_next_fetch_events = remaining
end

local function record_pokey(frame, reg, data, pc)
    local t = manager.machine.time
    local event = {
        frame = frame,
        reg = reg,
        data = data,
        pc = pc,
        secs = t.seconds,
        attos = tostring(t.attoseconds),
        seconds = timestamp_seconds(t),
    }
    attach_cycle_fields(event)
    if should_trace_fetch() then attach_last_sound_fetch(event) end
    table.insert(writes, event)
end

local function record_ym(frame, reg, data, pc)
    if YM_OUT_PATH == nil or YM_OUT_PATH == "" then return end
    local t = manager.machine.time
    local event = {
        frame = frame,
        reg = reg,
        data = data,
        pc = pc,
        secs = t.seconds,
        attos = tostring(t.attoseconds),
        seconds = timestamp_seconds(t),
    }
    attach_cycle_fields(event)
    if should_trace_fetch() then attach_last_sound_fetch(event) end
    table.insert(ym_writes, event)
end

local function sound_cpu_state_fields()
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

local function record_sound_cmd(data)
    if CMD_OUT_PATH == nil or CMD_OUT_PATH == "" then return end
    local t = manager.machine.time
    local seconds = timestamp_seconds(t)
    if cmd_frame_origin_seconds[frame_count] == nil then
        cmd_frame_origin_seconds[frame_count] = seconds
    end
    local cycle_in_frame = current_cycle_in_frame(seconds)
    if cycle_in_frame == nil then
        cycle_in_frame = math.floor(((seconds - cmd_frame_origin_seconds[frame_count]) * SOUND_CPU_HZ) + 0.5)
    end
    local cmd = {
        sourceIndex = #cmds,
        frame = frame_count,
        byte = data & 0xff,
        secs = t.seconds,
        attos = tostring(t.attoseconds),
        seconds = seconds,
        cycleInFrame = cycle_in_frame,
    }
    for k, v in pairs(sound_cpu_state_fields()) do cmd[k] = v end
    if should_trace_fetch() then
        attach_last_sound_fetch(cmd)
        table.insert(pending_next_fetch_events, cmd)
    end
    table.insert(cmds, cmd)
    table.insert(pending_sound_cmd_indices, cmd.sourceIndex)
end

local function record_sound_cmd_read(data)
    if CMD_OUT_PATH == nil or CMD_OUT_PATH == "" then return end
    local t = manager.machine.time
    local seconds = timestamp_seconds(t)
    local frame_origin_seconds = cmd_frame_origin_seconds[frame_count]
    local cycle_in_frame = current_cycle_in_frame(seconds)
    if cycle_in_frame == nil and frame_origin_seconds ~= nil then
        cycle_in_frame = math.floor(((seconds - frame_origin_seconds) * SOUND_CPU_HZ) + 0.5)
    end
    local source_index = nil
    if #pending_sound_cmd_indices > 0 then
        source_index = table.remove(pending_sound_cmd_indices, 1)
    end
    local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
    local read_event = {
        frame = frame_count,
        byte = data & 0xff,
        secs = t.seconds,
        attos = tostring(t.attoseconds),
        seconds = seconds,
        cycleInFrame = cycle_in_frame,
        sourceIndex = source_index,
        pc = pc,
    }
    if should_trace_fetch() then attach_last_sound_fetch(read_event) end
    table.insert(sound_cmd_reads, read_event)
end

local function record_reply_read(data, mask)
    if CMD_OUT_PATH == nil or CMD_OUT_PATH == "" or not EMBED_REPLY_IN_CMD then return end
    local t = manager.machine.time
    local pc = maincpu.state["PC"] and maincpu.state["PC"].value or -1
    table.insert(main_reply_reads, {
        frame = frame_count,
        val = data & 0xff,
        pc = pc,
        mask = mask & 0xffff,
        secs = t.seconds,
        attos = tostring(t.attoseconds),
    })
end

local function record_status_read(data)
    if STATUS_OUT_PATH == nil or STATUS_OUT_PATH == "" then return end
    local t = manager.machine.time
    local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
    local val = data & 0xff
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
            secs = t.seconds,
            attos = tostring(t.attoseconds),
        })
    end
    status_read_count = status_read_count + 1
end

local function write_injection_sequence(out)
    out:write('"injectSequence": [')
    for i, injection in ipairs(injections) do
        local sep = (i < #injections) and "," or ""
        out:write(string.format('{"frame":%d,"byte":"0x%02x","done":%s}%s',
            injection.frame, injection.byte & 0xff, injection.done and "true" or "false", sep))
    end
    out:write("]")
end

local function write_cmd_tape()
    if CMD_OUT_PATH == nil or CMD_OUT_PATH == "" then return end
    local out = assert(io.open(CMD_OUT_PATH, "w"))
    out:write("{\n")
    out:write(string.format('  "frame": %d,\n', frame_count))
    out:write(string.format('  "coinFrame": %d,\n', COIN_FRAME))
    out:write(string.format('  "startFrame": %d,\n', START_FRAME))
    out:write(string.format('  "soundCpuHz": %.9f,\n', SOUND_CPU_HZ))
    if INJECT_FRAME == nil or INJECT_BYTE == nil then
        out:write('  "injectFrame": null,\n')
        out:write('  "injectByte": null,\n')
    else
        out:write(string.format('  "injectFrame": %d,\n', INJECT_FRAME))
        out:write(string.format('  "injectByte": "0x%02x",\n', INJECT_BYTE & 0xff))
    end
    out:write('  ')
    write_injection_sequence(out)
    out:write(",\n")
    out:write(string.format('  "mainReplyReads": %d,\n', #main_reply_reads))
    if EMBED_REPLY_IN_CMD then
        out:write('  "replyAcks": [\n')
        for i, r in ipairs(main_reply_reads) do
            local sep = (i < #main_reply_reads) and "," or ""
            out:write(string.format(
                '    {"frame": %d, "val": "0x%02x", "pc": "0x%04x", "mask": "0x%04x", "secs": %d, "attos": "%s"}%s\n',
                r.frame, r.val, r.pc, r.mask, r.secs, r.attos, sep))
        end
        out:write("  ],\n")
    end
    out:write(string.format('  "soundCmdReadCount": %d,\n', #sound_cmd_reads))
    out:write('  "soundCmdReads": [\n')
    for i, r in ipairs(sound_cmd_reads) do
        local sep = (i < #sound_cmd_reads) and "," or ""
        out:write(string.format('    {"frame": %d, "byte": %d, "secs": %d, "attos": "%s"',
            r.frame, r.byte, r.secs, r.attos))
        if r.cycleInFrame ~= nil then out:write(string.format(', "cycleInFrame": %d', r.cycleInFrame)) end
        if r.sourceIndex ~= nil then out:write(string.format(', "sourceIndex": %d', r.sourceIndex)) end
        if r.pc ~= nil then out:write(string.format(', "pc": "0x%04x"', r.pc)) end
        if r.instPc ~= nil then
            out:write(string.format(
                ', "instPc": "0x%04x", "instOpcode": "0x%02x", "instFrame": %d, "instSecs": %d, "instAttos": "%s", "instDeltaCycles": %d',
                r.instPc, r.instOpcode, r.instFrame, r.instSecs, r.instAttos, r.instDeltaCycles))
        end
        out:write(string.format('}%s\n', sep))
    end
    out:write("  ],\n")
    out:write(string.format('  "count": %d,\n', #cmds))
    out:write('  "cmds": [\n')
    for i, c in ipairs(cmds) do
        local sep = (i < #cmds) and "," or ""
        out:write(string.format('    {"frame": %d, "byte": %d, "secs": %d, "attos": "%s", "cycleInFrame": %d',
            c.frame, c.byte, c.secs, c.attos, c.cycleInFrame or 0))
        if c.soundPc ~= nil then out:write(string.format(', "soundPc": "0x%04x"', c.soundPc)) end
        if c.soundA ~= nil then out:write(string.format(', "soundA": "0x%02x"', c.soundA)) end
        if c.soundX ~= nil then out:write(string.format(', "soundX": "0x%02x"', c.soundX)) end
        if c.soundY ~= nil then out:write(string.format(', "soundY": "0x%02x"', c.soundY)) end
        if c.soundP ~= nil then out:write(string.format(', "soundP": "0x%02x"', c.soundP)) end
        if c.soundSp ~= nil then out:write(string.format(', "soundSp": "0x%02x"', c.soundSp)) end
        if c.instPc ~= nil then
            out:write(string.format(
                ', "instPc": "0x%04x", "instOpcode": "0x%02x", "instFrame": %d, "instSecs": %d, "instAttos": "%s", "instDeltaCycles": %d',
                c.instPc, c.instOpcode, c.instFrame, c.instSecs, c.instAttos, c.instDeltaCycles))
        end
        if c.nextInstPc ~= nil then
            out:write(string.format(
                ', "nextInstPc": "0x%04x", "nextInstOpcode": "0x%02x", "nextInstFrame": %d, "nextInstSecs": %d, "nextInstAttos": "%s", "nextInstDeltaCycles": %d',
                c.nextInstPc, c.nextInstOpcode, c.nextInstFrame, c.nextInstSecs, c.nextInstAttos, c.nextInstDeltaCycles))
        end
        if c.nextChronoInstPc ~= nil then
            out:write(string.format(
                ', "nextChronoInstPc": "0x%04x", "nextChronoInstOpcode": "0x%02x", "nextChronoInstFrame": %d, "nextChronoInstSecs": %d, "nextChronoInstAttos": "%s", "nextChronoInstDeltaCycles": %d',
                c.nextChronoInstPc, c.nextChronoInstOpcode, c.nextChronoInstFrame, c.nextChronoInstSecs, c.nextChronoInstAttos, c.nextChronoInstDeltaCycles))
        end
        out:write(string.format('}%s\n', sep))
    end
    out:write("  ]\n")
    out:write("}\n")
    out:close()
    print(string.format("[pokey] %d cmds saved to %s", #cmds, CMD_OUT_PATH))
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
    print(string.format("[pokey] %d status reads (%d base runs) saved to %s",
        status_read_count, #status_base_runs, STATUS_OUT_PATH))
end

local function write_ym_json()
    if YM_OUT_PATH == nil or YM_OUT_PATH == "" then return end
    local out = assert(io.open(YM_OUT_PATH, "w"))
    out:write("{")
    if INJECT_FRAME == nil or INJECT_BYTE == nil then
        out:write('"injectFrame": null, "injectByte": null, ')
    else
        out:write(string.format('"injectFrame": %d, "injectByte": "0x%02x", ',
            INJECT_FRAME, INJECT_BYTE & 0xff))
    end
    write_injection_sequence(out)
    out:write(', ')
    out:write('"writes": [\n')
    for i, w in ipairs(ym_writes) do
        local sep = (i < #ym_writes) and "," or ""
        out:write(string.format(
            '  {"reg":"0x%02x","val":"0x%02x","pc":"0x%04x","frame":%d,"secs":%d,"attos":"%s"',
            w.reg, w.data, w.pc, w.frame, w.secs, w.attos))
        if w.cycleInFrame ~= nil then
            out:write(string.format(',"cycleInFrame":%d,"cycle":%d', w.cycleInFrame, w.cycle))
        end
        if w.instPc ~= nil then
            out:write(string.format(
                ',"instPc":"0x%04x","instOpcode":"0x%02x","instFrame":%d,"instSecs":%d,"instAttos":"%s","instDeltaCycles":%d',
                w.instPc, w.instOpcode, w.instFrame, w.instSecs, w.instAttos, w.instDeltaCycles))
        end
        out:write(string.format('}%s\n', sep))
    end
    out:write("]}\n")
    out:close()
    print(string.format("[pokey] %d YM writes saved to %s", #ym_writes, YM_OUT_PATH))
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
        table.insert(tap_handles, main_mem:install_read_tap(0xF20000, 0xF20007, "p_trackball", function(o,d,m) return d end))
        table.insert(tap_handles, main_mem:install_read_tap(0xF60000, 0xF60003, "p_sw", function(o,d,m) return d end))
        table.insert(tap_handles, main_mem:install_read_tap(0xFC0000, 0xFC0001, "p_response", function(o,d,m)
            record_reply_read(d, m)
            return d
        end))
        table.insert(tap_handles, main_mem:install_read_tap(0xFE0000, 0xFE0001, "p_cmd_r", function(o,d,m) return d end))
        table.insert(tap_handles, main_mem:install_write_tap(0xFE0000, 0xFE0001, "p_cmd_w", function(o,d,m)
            if (m & 0xff) ~= 0 then record_sound_cmd(d) end
            return d
        end))
        table.insert(tap_handles, sound_mem:install_read_tap(0x1820, 0x1820, "p_coin", function(o,d,m)
            record_status_read(d)
            return d
        end))
        table.insert(tap_handles, sound_mem:install_read_tap(0x1810, 0x1810, "p_cmd_sound_read", function(o,d,m)
            record_sound_cmd_read(d)
            return d
        end))
        if TRACE_FETCH then
            table.insert(tap_handles, sound_mem:install_read_tap(0x8000, 0xFFFF, "p_fetch", function(o, d, m)
                if should_trace_fetch() then
                    local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
                    if pc == o then
                        local t = manager.machine.time
                        last_sound_fetch = {
                            frame = frame_count,
                            pc = pc,
                            opcode = d & 0xff,
                            secs = t.seconds,
                            attos = tostring(t.attoseconds),
                            seconds = timestamp_seconds(t),
                        }
                        attach_next_sound_fetch_to_pending(last_sound_fetch)
                    end
                end
                return d
            end))
        end
        -- POKEY at 0x1870-0x187F mirror 0x2780. Tap 0x1000-0x3FFF, filter
        table.insert(tap_handles, sound_mem:install_write_tap(0x1000, 0x3FFF, "p_w", function(o, d, m)
            local ym_masked = o & 0xD871
            if ym_masked == 0x1800 then
                selected_ym_reg = d & 0xff
            elseif ym_masked == 0x1801 then
                local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
                record_ym(frame_count, selected_ym_reg, d & 0xff, pc)
                if MUTE_YM and selected_ym_reg == 0x08 then
                    return 0
                end
            end
            local masked = o & 0xD87F
            if (masked & 0xFFF0) == 0x1870 then
                local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
                record_pokey(frame_count, o & 0x0F, d & 0xff, pc)
            end
            return d
        end))
        installed = true
        local inject_msg = #injections == 0
            and ""
            or string.format(" injections=%d first=f%d:0x%02x",
                #injections, injections[1].frame, injections[1].byte)
        print("[pokey] tap installed" .. inject_msg .. (MUTE_YM and " muteYM=1" or "") ..
            ((CMD_OUT_PATH ~= nil and CMD_OUT_PATH ~= "") and " cmdOut=1" or "") ..
            ((YM_OUT_PATH ~= nil and YM_OUT_PATH ~= "") and " ymOut=1" or "") ..
            (TRACE_FETCH and string.format(" traceFetch=%d..%d", TRACE_FETCH_FROM, TRACE_FETCH_TO) or ""))
    end
    frame_count = frame_count + 1
    frame_start_seconds[frame_count] = timestamp_seconds(manager.machine.time)
    if ports[":1820"] and ports[":1820"].fields["Coin 1"] then
        ports[":1820"].fields["Coin 1"]:set_value(in_pulse(frame_count + 1, COIN_FRAME) and 1 or 0)
    end
    if ports[":F60000"] and ports[":F60000"].fields["1 Player Start"] then
        ports[":F60000"].fields["1 Player Start"]:set_value(in_pulse(frame_count + 1, START_FRAME) and 1 or 0)
    end
    for _, injection in ipairs(injections) do
        if not injection.done and frame_count == injection.frame then
            if main_mem.write_u8 ~= nil then
                main_mem:write_u8(0xFE0001, injection.byte & 0xff)
            else
                main_mem:write_u16(0xFE0000, injection.byte & 0xff)
            end
            injection.done = true
            print(string.format("[pokey] injected cmd 0x%02x at frame %d", injection.byte & 0xff, frame_count))
        end
    end
    if frame_count >= TARGET_FRAME then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write(string.format('{"writeCount": %d, ', #writes))
        if INJECT_FRAME == nil or INJECT_BYTE == nil then
            out:write('"injectFrame": null, "injectByte": null, ')
        else
            out:write(string.format('"injectFrame": %d, "injectByte": "0x%02x", ',
                INJECT_FRAME, INJECT_BYTE & 0xff))
        end
        write_injection_sequence(out)
        out:write(', ')
        out:write('"writes": [\n')
        for i, w in ipairs(writes) do
            local sep = (i < #writes) and "," or ""
            out:write(string.format(
                '  {"frame":%d,"reg":"0x%x","data":"0x%02x","pc":"0x%04x","secs":%d,"attos":"%s"',
                w.frame, w.reg, w.data, w.pc, w.secs, w.attos))
            if w.cycleInFrame ~= nil then
                out:write(string.format(',"cycleInFrame":%d,"cycle":%d', w.cycleInFrame, w.cycle))
            end
            if w.instPc ~= nil then
                out:write(string.format(
                    ',"instPc":"0x%04x","instOpcode":"0x%02x","instFrame":%d,"instSecs":%d,"instAttos":"%s","instDeltaCycles":%d',
                    w.instPc, w.instOpcode, w.instFrame, w.instSecs, w.instAttos, w.instDeltaCycles))
            end
            out:write(string.format('}%s\n', sep))
        end
        out:write("]}\n")
        out:close()
        print(string.format("[pokey] %d writes saved", #writes))
        write_ym_json()
        write_cmd_tape()
        write_status_json()
        manager.machine:exit()
    end
end)
