-- mame_sound_cmd_capture.lua - capture 68K -> 6502 commands while the main 68K is
-- in real gameplay (scripted coin+start). Replicates the install + input
-- injection pattern from oracle/mame_playable_input_capture.lua, then adds an
-- install_write_tap on $FE0001 to record sound commands.
--
-- Output JSON: { frame, count, cmds: [{frame, byte}, ...] }
--
-- Env:
--   MARBLE_SOUND_CMD_TARGET_FRAME - total frames (default 3000)
--   MARBLE_SOUND_CMD_OUT          — output file (default /tmp/mame_sound_cmds.json)
--   MARBLE_SOUND_COIN_FRAME       - first coin pulse frame (default 1200)
--   MARBLE_SOUND_START_FRAME      - first start pulse frame (default 1500)
--   MARBLE_SOUND_TRACKBALL_START  - first trackball-route frame (default 2020)
--   MARBLE_SOUND_ROUTE            — optional route, e.g. D:171,R:206
--   MARBLE_SOUND_ROUTE_STEP       - route delta per frame (default 8)
--   MARBLE_SOUND_STATUS_OUT       — optional output for $1820 reads
--   MARBLE_SOUND_STATUS_MAX_READS — max $1820 reads to record (default 2000000)
--   MARBLE_SOUND_STATUS_FULL      — 1 to include every read, not only base runs
--   MARBLE_SOUND_REPLY_OUT        — optional output for main CPU $FC0001 reads
--   MARBLE_SOUND_CMD_EMBED_REPLY  — 1 to embed main reply reads as replyAcks in cmd output
--   The cmd output always embeds soundCmdReads, one row per sound CPU $1810
--   command-latch read, with sourceIndex pointing at cmds[sourceIndex + 1].
--   MARBLE_SOUND_CPU_HZ           — sound CPU clock for cycleInFrame derivation
--                                  (default 14.318181 MHz / 8)
--   MARBLE_SOUND_INJECT_FRAME     — optional frame for one forced cmd write
--   MARBLE_SOUND_INJECT_BYTE      — byte for MARBLE_SOUND_INJECT_FRAME
--   MARBLE_SOUND_INJECT_START_FRAME — optional first frame for forced cmd range
--   MARBLE_SOUND_INJECT_SPACING   — frames between forced range bytes
--   MARBLE_SOUND_INJECT_COUNT     — number of forced range bytes
--   MARBLE_SOUND_INJECT_FIRST_BYTE — first byte in forced range
--
-- Usage:
--   mame marble -rompath roms -nothrottle -skip_gameinfo -video none \
--     -nvram_directory /tmp/snd_nv -cfg_directory /tmp/snd_cfg -nonvram_save \
--     -autoboot_script oracle/mame_sound_cmd_capture.lua -autoboot_delay 0

local TARGET_FRAME = tonumber(os.getenv("MARBLE_SOUND_CMD_TARGET_FRAME") or "3000")
local OUT_PATH = os.getenv("MARBLE_SOUND_CMD_OUT") or "/tmp/mame_sound_cmds.json"
local STATUS_OUT_PATH = os.getenv("MARBLE_SOUND_STATUS_OUT")
local REPLY_OUT_PATH = os.getenv("MARBLE_SOUND_REPLY_OUT")
local EMBED_REPLY_IN_CMD = os.getenv("MARBLE_SOUND_CMD_EMBED_REPLY") == "1"
local STATUS_MAX_READS = tonumber(os.getenv("MARBLE_SOUND_STATUS_MAX_READS") or "2000000")
local STATUS_FULL = os.getenv("MARBLE_SOUND_STATUS_FULL") == "1"
local SOUND_CPU_HZ = tonumber(os.getenv("MARBLE_SOUND_CPU_HZ") or "1789772.625")
local COIN_FRAME = tonumber(os.getenv("MARBLE_SOUND_COIN_FRAME") or "1200")
local START_FRAME = tonumber(os.getenv("MARBLE_SOUND_START_FRAME") or "1500")
local TRACKBALL_START = tonumber(os.getenv("MARBLE_SOUND_TRACKBALL_START") or "2020")
local ROUTE_RAW = os.getenv("MARBLE_SOUND_ROUTE") or ""
local ROUTE_STEP = tonumber(os.getenv("MARBLE_SOUND_ROUTE_STEP") or "8") or 8
local PULSE_LEN = 15
if ROUTE_STEP < 1 then ROUTE_STEP = 1 end
ROUTE_STEP = math.floor(ROUTE_STEP)

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
    error("[snd_cmd_capture] set both MARBLE_SOUND_INJECT_FRAME and MARBLE_SOUND_INJECT_BYTE")
end
local injections = {}

local function add_injection(frame, byte)
    table.insert(injections, {
        frame = math.floor(frame),
        byte = byte & 0xff,
        done = false,
    })
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

local maincpu, main_mem
local audiocpu, sound_mem
local ports
local frame_count = 0
local installed = false
local cmds = {}
local sound_cmd_reads = {}
local next_sound_cmd_read_source = 1
local status_reads = {}
local status_base_runs = {}
local status_read_count = 0
local main_reply_reads = {}
local sound_coin_reads = 0
local main_switch_reads = 0
local main_reply_read_count = 0
local frame_start_time = {}
local script_trackball_x = 0xff
local script_trackball_y = 0xff
local route_steps = {}
local route_total = 0
-- I tap handle restituiti da install_*_tap MUSCONO essere mantenuti in vita:
-- without a Lua reference, GC releases them and the tap stops firing (verified
-- empirically). Mame_playable_input_capture.lua applies the same pattern.
local tap_handles = {}

local function in_pulse(frame, start)
    return frame >= start and frame < (start + PULSE_LEN)
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

local ROUTE_DELTA_UNITS = {
    N = {0, 0},
    U = {0, -1},
    D = {0, 1},
    L = {-1, 0},
    R = {1, 0},
    UL = {-1, -1},
    UR = {1, -1},
    DL = {-1, 1},
    DR = {1, 1},
    BR = {0.5, -0.75},
    BL = {-0.5, 0.75},
}

local function route_delta(name)
    local unit = ROUTE_DELTA_UNITS[name]
    if unit == nil then return nil end
    local function round(v)
        if v >= 0 then return math.floor(v + 0.5) end
        return math.ceil(v - 0.5)
    end
    return {
        round(unit[1] * ROUTE_STEP),
        round(unit[2] * ROUTE_STEP),
    }
end

local function parse_route()
    if ROUTE_RAW == "" then return end
    for tok in string.gmatch(ROUTE_RAW, "([^,]+)") do
        local name, count_s = tok:match("^%s*([A-Za-z]+)%s*:%s*(%d+)%s*$")
        if name == nil then
            error("[snd_cmd_capture] bad MARBLE_SOUND_ROUTE token: " .. tok)
        end
        name = string.upper(name)
        local delta = route_delta(name)
        if delta == nil then
            error("[snd_cmd_capture] unknown route direction: " .. name)
        end
        local count = tonumber(count_s)
        if count == nil or count <= 0 then
            error("[snd_cmd_capture] bad route count: " .. count_s)
        end
        route_total = route_total + count
        table.insert(route_steps, {
            until_frame = route_total,
            screen_dx = delta[1],
            screen_dy = delta[2],
        })
    end
    print(string.format("[snd_cmd_capture] scripted route: %s (%d frames, step=%d)",
        ROUTE_RAW, route_total, ROUTE_STEP))
end

parse_route()

local function signed_delta(v)
    v = v & 0xff
    if v >= 0x80 then return v - 0x100 end
    return v
end

local function scripted_trackball_delta(frame)
    local t = frame - TRACKBALL_START
    if #route_steps > 0 then
        if t >= 0 then
            local route_frame = t + 1
            for _, step in ipairs(route_steps) do
                if route_frame <= step.until_frame then
                    -- Browser live controls use screen-space axes; Marble's raw
                    -- trackball ports are inverted on both axes for the same feel.
                    return (-step.screen_dx) & 0xff, (-step.screen_dy) & 0xff
                end
            end
        end
        return 0, 0
    end
    return 0, 0
end

local function install_taps()
    -- Exact replica of the playable_input_capture pattern: install_read_tap on
    -- main CPU input ports. These taps force MAME to avoid bypassing bus decode
    -- even for frequent accesses such as $1820 in the attract loop.
    maincpu = manager.machine.devices[":maincpu"]
    main_mem = maincpu.spaces["program"]
    for _, tag in ipairs({":audiocpu", ":soundcpu"}) do
        if manager.machine.devices[tag] then
            audiocpu = manager.machine.devices[tag]
            break
        end
    end
    sound_mem = audiocpu.spaces["program"]
    ports = manager.machine.ioport.ports

    -- Read taps on main CPU input ports (observational, return data unchanged).
    table.insert(tap_handles,
        main_mem:install_read_tap(0xF20000, 0xF20007, "snd_cap_trackball", function(o, d, m) return d end))
    table.insert(tap_handles,
        main_mem:install_read_tap(0xF60000, 0xF60003, "snd_cap_switches", function(o, d, m)
            main_switch_reads = main_switch_reads + 1
            return d
        end))
    table.insert(tap_handles,
        main_mem:install_read_tap(0xFC0000, 0xFC0001, "snd_cap_response", function(o, d, m)
            main_reply_read_count = main_reply_read_count + 1
            if (REPLY_OUT_PATH ~= nil and REPLY_OUT_PATH ~= "") or EMBED_REPLY_IN_CMD then
                local t = manager.machine.time
                local pc = maincpu.state["PC"] and maincpu.state["PC"].value or -1
                table.insert(main_reply_reads, {
                    frame = frame_count,
                    val = d & 0xff,
                    pc = pc,
                    mask = m & 0xffff,
                    secs = t.seconds,
                    attos = tostring(t.attoseconds),
                })
            end
            return d
        end))
    table.insert(tap_handles,
        main_mem:install_read_tap(0xFE0000, 0xFE0001, "snd_cap_cmd_r", function(o, d, m) return d end))

    -- Sound CPU coin port read tap.
    table.insert(tap_handles,
        sound_mem:install_read_tap(0x1820, 0x1820, "snd_cap_coin", function(o, d, m)
            sound_coin_reads = sound_coin_reads + 1
            if STATUS_OUT_PATH ~= nil and STATUS_OUT_PATH ~= "" then
                local t = manager.machine.time
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
                        secs = t.seconds,
                        attos = tostring(t.attoseconds),
                    })
                end
                status_read_count = status_read_count + 1
            end
            return d
        end))

    table.insert(tap_handles,
        sound_mem:install_read_tap(0x1810, 0x1810, "snd_cap_cmd_read", function(o, d, m)
            local t = manager.machine.time
            local secs = t.seconds
            local attos = tostring(t.attoseconds)
            local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
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
            return d
        end))

    -- Il tap critico: $FE0001 write da main = soundlatch cmd al sound 6502.
    -- 68010 16-bit bus: write to $FE0000 with mask & 0xff != 0 hits
    -- the odd byte ($FE0001), the real soundlatch.
    -- ALSO captures sub-frame cycle offset for cycle-precise replay (sessione 4l).
    table.insert(tap_handles,
        main_mem:install_write_tap(0xFE0000, 0xFE0001, "snd_cap_cmd_w", function(o, d, m)
            if (m & 0xff) ~= 0 then
                local t = manager.machine.time
                local secs = t.seconds
                local attos = tostring(t.attoseconds)
                local state = sound_cpu_state_fields()
                local cmd = {
                    frame = frame_count, byte = (d & 0xff),
                    secs = secs, attos = attos,
                    cycleInFrame = current_video_cycle_in_frame(secs, attos),
                }
                for k, v in pairs(state) do cmd[k] = v end
                table.insert(cmds, cmd)
            end
            return d
        end))

    local inject_msg = #injections == 0
        and ""
        or string.format(" injections=%d first=f%d:0x%02x",
            #injections, injections[1].frame, injections[1].byte)
    print(string.format("[snd_cmd_capture] taps installed; coin=f%d start=f%d target=f%d%s",
        COIN_FRAME, START_FRAME, TARGET_FRAME, inject_msg))
end

local function apply_input(frame)
    if ports == nil then return end
    local coin_pressed = in_pulse(frame, COIN_FRAME)
    local start_pressed = in_pulse(frame, START_FRAME)
    local dx, dy = scripted_trackball_delta(frame)
    script_trackball_x = (script_trackball_x + signed_delta(dx)) & 0xff
    script_trackball_y = (script_trackball_y + signed_delta(dy)) & 0xff

    if ports[":IN0"] and ports[":IN0"].fields["Trackball X"] then
        ports[":IN0"].fields["Trackball X"]:set_value(script_trackball_x)
    end
    if ports[":IN1"] and ports[":IN1"].fields["Trackball Y"] then
        ports[":IN1"].fields["Trackball Y"]:set_value(script_trackball_y)
    end

    -- Lua set_value uses logical field activation. Coin 1 is IP_ACTIVE_LOW in
    -- the driver, so set_value(1) = pressed and set_value(0) = released.
    -- 1 Player Start (port :F60000, IP_ACTIVE_LOW): set_value(1) = pressed, 0 = released
    local coin_port = ports[":1820"]
    if coin_port and coin_port.fields["Coin 1"] then
        coin_port.fields["Coin 1"]:set_value(coin_pressed and 1 or 0)
    end
    local start_port = ports[":F60000"]
    if start_port and start_port.fields["1 Player Start"] then
        start_port.fields["1 Player Start"]:set_value(start_pressed and 1 or 0)
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
            print(string.format("[snd_cmd_capture] injected cmd 0x%02x at frame %d",
                injection.byte & 0xff, frame_count))
        end
    end
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

local function dump_json()
    local out = assert(io.open(OUT_PATH, "w"))
    out:write("{\n")
    out:write(string.format('  "frame": %d,\n', frame_count))
    out:write(string.format('  "coinFrame": %d,\n', COIN_FRAME))
    out:write(string.format('  "startFrame": %d,\n', START_FRAME))
    out:write(string.format('  "trackballStart": %d,\n', TRACKBALL_START))
    out:write(string.format('  "route": "%s",\n', ROUTE_RAW))
    out:write(string.format('  "routeStep": %d,\n', ROUTE_STEP))
    if INJECT_FRAME == nil or INJECT_BYTE == nil then
        out:write('  "injectFrame": null,\n')
        out:write('  "injectByte": null,\n')
    else
        out:write(string.format('  "injectFrame": %d,\n', INJECT_FRAME))
        out:write(string.format('  "injectByte": "0x%02x",\n', INJECT_BYTE & 0xff))
    end
    out:write('  "injectSequence": [\n')
    for i, injection in ipairs(injections) do
        local sep = (i < #injections) and "," or ""
        out:write(string.format(
            '    {"frame": %d, "byte": "0x%02x", "done": %s}%s\n',
            injection.frame, injection.byte & 0xff, injection.done and "true" or "false", sep))
    end
    out:write("  ],\n")
    out:write(string.format('  "soundCoinReads": %d,\n', sound_coin_reads))
    out:write(string.format('  "mainSwitchReads": %d,\n', main_switch_reads))
    out:write(string.format('  "mainReplyReads": %d,\n', main_reply_read_count))
    if EMBED_REPLY_IN_CMD then
        out:write('  "replyAcks": [\n')
        for i, r in ipairs(main_reply_reads) do
            local sep = (i < #main_reply_reads) and "," or ""
            write_reply_read_json(out, r, sep)
        end
        out:write("  ],\n")
    end
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
    print(string.format("[snd_cmd_capture] dumped %d cmds across %d frames to %s (sound_coin_reads=%d, main_switch_reads=%d)",
        #cmds, frame_count, OUT_PATH, sound_coin_reads, main_switch_reads))
end

local function dump_reply_json()
    if REPLY_OUT_PATH == nil or REPLY_OUT_PATH == "" then return end
    local out = assert(io.open(REPLY_OUT_PATH, "w"))
    out:write("{\n")
    out:write(string.format('  "frame": %d,\n', frame_count))
    out:write(string.format('  "coinFrame": %d,\n', COIN_FRAME))
    out:write(string.format('  "startFrame": %d,\n', START_FRAME))
    out:write(string.format('  "mainReplyReadCount": %d,\n', #main_reply_reads))
    out:write('  "mainReplyReads": [\n')
    for i, r in ipairs(main_reply_reads) do
        local sep = (i < #main_reply_reads) and "," or ""
        write_reply_read_json(out, r, sep)
    end
    out:write("  ]\n")
    out:write("}\n")
    out:close()
    print(string.format("[snd_cmd_capture] dumped %d main reply reads to %s",
        #main_reply_reads, REPLY_OUT_PATH))
end

local function dump_status_json()
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
    print(string.format("[snd_cmd_capture] dumped %d status reads (%d base runs) to %s",
        status_read_count, #status_base_runs, STATUS_OUT_PATH))
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
    maybe_inject_sound_command()

    if frame_count % 500 == 0 then
        print(string.format("[snd_cmd_capture] f%d cmds=%d snd_coin_reads=%d main_sw_reads=%d",
            frame_count, #cmds, sound_coin_reads, main_switch_reads))
    end

    if frame_count >= TARGET_FRAME then
        dump_json()
        dump_status_json()
        dump_reply_json()
        manager.machine:exit()
    end
end)
