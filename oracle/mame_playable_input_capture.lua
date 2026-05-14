-- mame_playable_input_capture.lua — capture deterministic coin/start/playable input.
--
-- Outputs:
--   oracle/scenarios/input/playable_coin_start.json
--   oracle/scenarios/playable/*.json
--
-- The scripted session inserts a coin, presses START1, then drives the
-- trackball during level 1.  Scenario snapshots are warm seeds captured from
-- the real MAME run; TS replay injects the captured input bytes from there.
--
-- Environment:
--   MARBLE_PLAYABLE_OUT_DIR      scenario output directory
--   MARBLE_PLAYABLE_INPUT_OUT    input trace output path
--   MARBLE_PLAYABLE_SCENARIOS    optional CSV filter
--   MARBLE_PLAYABLE_TRACKBALL_START optional first scripted trackball frame
--   MARBLE_PLAYABLE_INPUT_TRACE_REF optional scenario inputTrace path

local OUT_DIR = os.getenv("MARBLE_PLAYABLE_OUT_DIR") or "oracle/scenarios/playable"
local INPUT_OUT = os.getenv("MARBLE_PLAYABLE_INPUT_OUT") or "oracle/scenarios/input/playable_coin_start.json"
local INPUT_TRACE_REF = os.getenv("MARBLE_PLAYABLE_INPUT_TRACE_REF") or "oracle/scenarios/input/playable_coin_start.json"
local ONLY_RAW = os.getenv("MARBLE_PLAYABLE_SCENARIOS") or ""
local FRAME_LIST_RAW = os.getenv("MARBLE_PLAYABLE_FRAME_LIST") or ""
local FRAME_COUNT = 100
local TRACKBALL_START = tonumber(os.getenv("MARBLE_PLAYABLE_TRACKBALL_START") or "2020") or 2020

local DEFAULT_SCENARIOS = {
    { name = "coin_start_to_level1", frame = 2045, description = "Level 1 entry after scripted coin/start" },
    { name = "level1_trackball_short", frame = 2240, description = "Level 1 deterministic short trackball replay" },
    { name = "level1_trackball_obstacle", frame = 2320, description = "Level 1 deterministic trackball replay near first obstacle" },
}

local SCENARIOS = {}
if FRAME_LIST_RAW ~= "" then
    for tok in string.gmatch(FRAME_LIST_RAW, "([^,]+)") do
        local name, frame_s = tok:match("^([^:]+):(%d+)$")
        if name == nil then
            frame_s = tok:match("^(%d+)$")
            if frame_s ~= nil then name = "candidate_" .. frame_s end
        end
        if name ~= nil and frame_s ~= nil then
            table.insert(SCENARIOS, {
                name = name,
                frame = tonumber(frame_s),
                description = "Candidate playable warm seed",
            })
        end
    end
else
    SCENARIOS = DEFAULT_SCENARIOS
end

local only = {}
for tok in string.gmatch(ONLY_RAW, "([^,]+)") do
    only[tok] = true
end
local use_filter = next(only) ~= nil

local selected = {}
for _, scenario in ipairs(SCENARIOS) do
    if not use_filter or only[scenario.name] then
        table.insert(selected, scenario)
    end
end
if #selected == 0 then
    error("[mame_playable_input_capture] no scenarios selected")
end

local function ensure_dir(path)
    local dir = string.match(path, "^(.*)/[^/]+$")
    if dir ~= nil and dir ~= "" then
        os.execute(string.format("mkdir -p %q", dir))
    end
end

os.execute(string.format("mkdir -p %q", OUT_DIR))
ensure_dir(INPUT_OUT)

local cpu = nil
local mem = nil
local ports = nil
local slapstic_dev = nil
local frame_count = 0
local installed = false
local last_frame = 0
local capture_by_frame = {}

local current = {}
local frame_reads = {}
local frames = {}
local totals = {}
local sound_totals = {}
local tap_handles = {}
local script_buttons = 0
local script_dx = 0
local script_dy = 0

local INPUT_DEFAULTS = {
    [0xF20001] = 0xff,
    [0xF20003] = 0xff,
    [0xF20005] = 0xff,
    [0xF20007] = 0xff,
    [0xF60001] = 0x6f,
    [0xFC0001] = 0xff,
    [0xFE0001] = 0xff,
}

for addr, value in pairs(INPUT_DEFAULTS) do
    current[addr] = value
end

for _, scenario in ipairs(selected) do
    scenario.snapshots = {}
    for f = scenario.frame, scenario.frame + FRAME_COUNT do
        if capture_by_frame[f] == nil then capture_by_frame[f] = {} end
        table.insert(capture_by_frame[f], scenario)
    end
    if scenario.frame + FRAME_COUNT > last_frame then
        last_frame = scenario.frame + FRAME_COUNT
    end
end
last_frame = math.max(last_frame, 2500)

local function key(addr)
    return string.format("%06x", addr)
end

local function json_escape(s)
    return string.gsub(s, '[%z\1-\31\\"]', function(c)
        if c == "\\" then return "\\\\" end
        if c == '"' then return '\\"' end
        return string.format("\\u%04x", string.byte(c))
    end)
end

local function read_count_json()
    local parts = {}
    local addrs = {}
    for addr, _ in pairs(frame_reads) do table.insert(addrs, addr) end
    table.sort(addrs)
    for _, addr in ipairs(addrs) do
        table.insert(parts, string.format('"%s":%d', key(addr), frame_reads[addr]))
    end
    return "{" .. table.concat(parts, ",") .. "}"
end

local function totals_json(tbl)
    local parts = {}
    local addrs = {}
    for addr, _ in pairs(tbl) do table.insert(addrs, addr) end
    table.sort(addrs)
    for _, addr in ipairs(addrs) do
        table.insert(parts, string.format('    "%s": %d', key(addr), tbl[addr]))
    end
    return "{\n" .. table.concat(parts, ",\n") .. "\n  }"
end

local function value(addr)
    if current[addr] ~= nil then return current[addr] end
    return 0xff
end

local function record_read(addr, data)
    local value_u8 = data & 0xff
    local canonical = addr
    if addr == 0xF20000 then canonical = 0xF20001 end
    if addr == 0xF20002 then canonical = 0xF20003 end
    if addr == 0xF20004 then canonical = 0xF20005 end
    if addr == 0xF20006 then canonical = 0xF20007 end
    if addr == 0xF60000 then canonical = 0xF60001 end
    if addr == 0xFC0000 then canonical = 0xFC0001 end
    if addr == 0xFE0000 then canonical = 0xFE0001 end
    current[canonical] = value_u8
    frame_reads[canonical] = (frame_reads[canonical] or 0) + 1
    totals[canonical] = (totals[canonical] or 0) + 1
end

local function normalize_tap_addr(base, offset)
    if offset < base then return base + offset end
    return offset
end

local function install_main_read_tap(lo, hi, name)
    local handle = mem:install_read_tap(lo, hi, name, function(offset, data, mask)
        record_read(normalize_tap_addr(lo, offset), data)
        return data
    end)
    table.insert(tap_handles, handle)
end

local function install_sound_read_tap(space, lo, hi, name)
    local handle = space:install_read_tap(lo, hi, name, function(offset, data, mask)
        local addr = normalize_tap_addr(lo, offset)
        sound_totals[addr] = (sound_totals[addr] or 0) + 1
        return data
    end)
    table.insert(tap_handles, handle)
end

local function scripted_input(frame)
    local buttons = 0
    if frame >= 60 and frame < 75 then buttons = buttons | 0x04 end
    if frame >= 180 and frame < 195 then buttons = buttons | 0x01 end

    local dx = 0
    local dy = 0
    local t = frame - TRACKBALL_START
    if t >= 0 and t < 110 then
        dx = 8
    elseif t >= 110 and t < 220 then
        dy = 8
    elseif t >= 220 and t < 330 then
        dx = -8
    elseif t >= 330 and t < 440 then
        dx = 4
        dy = -6
    end

    return buttons, dx, dy
end

local function apply_input_for_frame(frame)
    if ports == nil then return end
    script_buttons, script_dx, script_dy = scripted_input(frame)

    if ports[":IN0"] and ports[":IN0"].fields["Trackball X"] then
        ports[":IN0"].fields["Trackball X"]:set_value(script_dx & 0xff)
    end
    if ports[":IN1"] and ports[":IN1"].fields["Trackball Y"] then
        ports[":IN1"].fields["Trackball Y"]:set_value(script_dy & 0xff)
    end

    local start_port = ports[":F60000"]
    if start_port then
        if start_port.fields["1 Player Start"] then
            start_port.fields["1 Player Start"]:set_value((script_buttons & 0x01) ~= 0 and 0 or 1)
        end
        if start_port.fields["2 Players Start"] then
            start_port.fields["2 Players Start"]:set_value((script_buttons & 0x02) ~= 0 and 0 or 1)
        end
    end

    local coin_port = ports[":1820"]
    if coin_port then
        if coin_port.fields["Coin 1"] then
            coin_port.fields["Coin 1"]:set_value((script_buttons & 0x04) ~= 0 and 0 or 1)
        end
        if coin_port.fields["Left Coin"] then
            coin_port.fields["Left Coin"]:set_value(1)
        end
        if coin_port.fields["Right Coin"] then
            coin_port.fields["Right Coin"]:set_value(1)
        end
    end
end

local function switches_from_script()
    local v = 0x6f
    if (script_buttons & 0x01) ~= 0 then v = v & ~0x01 end
    if (script_buttons & 0x02) ~= 0 then v = v & ~0x02 end
    return v & 0xff
end

local function capture_input_frame()
    local switches = value(0xF60001)
    table.insert(frames, string.format(
        '    {"frame":%d,"trackballX":%d,"trackballY":%d,"trackball2X":%d,"trackball2Y":%d,' ..
        '"switches":%d,"buttons":%d,"coin1":%d,"scriptDx":%d,"scriptDy":%d,"readCounts":%s}',
        frame_count,
        value(0xF20001),
        value(0xF20003),
        value(0xF20005),
        value(0xF20007),
        switches,
        script_buttons,
        (script_buttons & 0x04) ~= 0 and 1 or 0,
        script_dx,
        script_dy,
        read_count_json()
    ))
end

local function write_input_json()
    local out = assert(io.open(INPUT_OUT, "w"))
    out:write("{\n")
    out:write('  "schemaVersion": 1,\n')
    out:write('  "source": "mame",\n')
    out:write('  "name": "playable_coin_start",\n')
    out:write('  "description": "Scripted coin/start plus deterministic level-1 trackball input",\n')
    out:write('  "startFrame": 1,\n')
    out:write(string.format('  "endFrame": %d,\n', last_frame))
    out:write(string.format('  "frameCount": %d,\n', #frames))
    out:write('  "addresses": {\n')
    out:write('    "trackballX": "0xf20001",\n')
    out:write('    "trackballY": "0xf20003",\n')
    out:write('    "trackball2X": "0xf20005",\n')
    out:write('    "trackball2Y": "0xf20007",\n')
    out:write('    "switches": "0xf60001",\n')
    out:write('    "soundCoin": "sound:0x1820",\n')
    out:write('    "soundResponse": "0xfc0001",\n')
    out:write('    "soundCommand": "0xfe0001"\n')
    out:write('  },\n')
    out:write('  "readTotals": ')
    out:write(totals_json(totals))
    out:write(",\n")
    out:write('  "soundReadTotals": ')
    out:write(totals_json(sound_totals))
    out:write(",\n")
    out:write('  "frames": [\n')
    out:write(table.concat(frames, ",\n"))
    out:write("\n  ]\n")
    out:write("}\n")
    out:close()
    print(string.format("[mame_playable_input_capture] saved input trace %s (%d frames)", INPUT_OUT, #frames))
end

local function hex_region(addr, size)
    local parts = {}
    for i = 0, size - 1 do
        parts[i + 1] = string.format("%02x", mem:read_u8(addr + i))
    end
    return table.concat(parts)
end

local function read_work_u8(off)
    return mem:read_u8(0x400000 + off)
end

local function read_work_u16(off)
    return ((read_work_u8(off) << 8) | read_work_u8(off + 1)) & 0xffff
end

local function read_work_u32(off)
    return ((read_work_u16(off) << 16) | read_work_u16(off + 2)) & 0xffffffff
end

local function read_current_bank()
    if slapstic_dev == nil then return -1 end
    local st = slapstic_dev.state
    if st ~= nil then
        local s = st["m_current_bank"]
        if s ~= nil then return s.value end
    end
    return -1
end

local BANK_FINGERPRINT_ADDRS = {0x81924, 0x81986, 0x81008, 0x80650}
local BANK_FINGERPRINTS = {
    {0x9f9c, 0xf01c, 0x80fc, 0x8440},
    {0x0000, 0x0000, 0xf058, 0xc049},
    {0x006e, 0x05e6, 0x2a66, 0x5747},
    {0x30a1, 0x35e6, 0x775d, 0xcc4b},
}

local function read_direct_word(addr)
    if mem == nil then return nil end
    if mem.readv_u16 ~= nil then return mem:readv_u16(addr) end
    if mem.readv_u8 ~= nil then
        return ((mem:readv_u8(addr) << 8) | mem:readv_u8(addr + 1)) & 0xffff
    end
    if mem.read_direct_u16 ~= nil then return mem:read_direct_u16(addr) end
    if mem.read_direct_u8 ~= nil then
        return ((mem:read_direct_u8(addr) << 8) | mem:read_direct_u8(addr + 1)) & 0xffff
    end
    return nil
end

local function infer_current_bank()
    local values = {}
    for i, addr in ipairs(BANK_FINGERPRINT_ADDRS) do
        local v = read_direct_word(addr)
        if v == nil then return -1 end
        values[i] = v
    end
    for bank = 1, 4 do
        local ok = true
        for i = 1, #BANK_FINGERPRINT_ADDRS do
            if values[i] ~= BANK_FINGERPRINTS[bank][i] then
                ok = false
                break
            end
        end
        if ok then return bank - 1 end
    end
    return -1
end

local function current_slapstic_bank()
    local bank = read_current_bank()
    if bank >= 0 then return bank end
    return infer_current_bank()
end

local function capture_snapshot(scenario, absolute_frame)
    local idx = absolute_frame - scenario.frame
    return string.format(
        '    {\n' ..
        '      "index": %d,\n' ..
        '      "frame": %d,\n' ..
        '      "slapsticBank": %d,\n' ..
        '      "irq4": {\n' ..
        '        "counterLong": %d,\n' ..
        '        "visibleCounter": %d,\n' ..
        '        "vblankMailbox": %d,\n' ..
        '        "mainState": %d,\n' ..
        '        "mode": %d,\n' ..
        '        "scrollDirty": %d,\n' ..
        '        "segment": %d\n' ..
        '      },\n' ..
        '      "workRam": "%s",\n' ..
        '      "playfieldRam": "%s",\n' ..
        '      "spriteRam": "%s",\n' ..
        '      "alphaRam": "%s",\n' ..
        '      "colorRam": "%s"\n' ..
        '    }',
        idx,
        absolute_frame,
        current_slapstic_bank(),
        read_work_u32(0x10),
        read_work_u16(0x14),
        read_work_u8(0x16),
        read_work_u16(0x390),
        read_work_u16(0x392),
        read_work_u8(0x39a),
        read_work_u8(0x3e4),
        hex_region(0x400000, 0x2000),
        hex_region(0xA00000, 0x2000),
        hex_region(0xA02000, 0x1000),
        hex_region(0xA03000, 0x1000),
        hex_region(0xB00000, 0x800)
    )
end

local function write_scenario(scenario)
    local path = OUT_DIR .. "/" .. scenario.name .. ".json"
    local out = assert(io.open(path, "w"))
    out:write("{\n")
    out:write(string.format('  "name": "%s",\n', json_escape(scenario.name)))
    out:write(string.format('  "description": "%s",\n', json_escape(scenario.description)))
    out:write(string.format('  "seedFrame": %d,\n', scenario.frame))
    out:write(string.format('  "oracleFrames": %d,\n', FRAME_COUNT))
    out:write(string.format('  "inputTrace": "%s",\n', json_escape(INPUT_TRACE_REF)))
    out:write('  "regions": {\n')
    out:write('    "workRam": {"address": "0x400000", "bytes": 8192},\n')
    out:write('    "playfieldRam": {"address": "0xa00000", "bytes": 8192},\n')
    out:write('    "spriteRam": {"address": "0xa02000", "bytes": 4096},\n')
    out:write('    "alphaRam": {"address": "0xa03000", "bytes": 4096},\n')
    out:write('    "colorRam": {"address": "0xb00000", "bytes": 2048},\n')
    out:write('    "hudWorkRam": {"address": "0x400500", "bytes": 512}\n')
    out:write('  },\n')
    out:write('  "snapshots": [\n')
    out:write(table.concat(scenario.snapshots, ",\n"))
    out:write("\n  ]\n")
    out:write("}\n")
    out:close()
    print(string.format("[mame_playable_input_capture] saved %s (%d snapshots)", path, #scenario.snapshots))
end

local function install_taps()
    install_main_read_tap(0xF20000, 0xF20007, "playable_input_trackball")
    install_main_read_tap(0xF60000, 0xF60003, "playable_input_switches")
    install_main_read_tap(0xFC0000, 0xFC0001, "playable_sound_response")
    install_main_read_tap(0xFE0000, 0xFE0001, "playable_sound_command")

    for _, tag in ipairs({":audiocpu", ":soundcpu", ":jsa:cpu"}) do
        local dev = manager.machine.devices[tag]
        if dev ~= nil and dev.spaces ~= nil and dev.spaces["program"] ~= nil then
            install_sound_read_tap(dev.spaces["program"], 0x1820, 0x1820, "playable_sound_coin")
            print(string.format("[mame_playable_input_capture] sound CPU tap tag: %s", tag))
            break
        end
    end
end

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
        ports = manager.machine.ioport.ports
        for _, tag in ipairs({":slapstic", ":maincpu:slapstic", ":slapstic_103"}) do
            if manager.machine.devices[tag] ~= nil then
                slapstic_dev = manager.machine.devices[tag]
                print(string.format("[mame_playable_input_capture] slapstic device tag: %s", tag))
                break
            end
        end
        if slapstic_dev == nil then
            print("[mame_playable_input_capture] WARN: slapstic device not found")
        end
    end
    if not installed then
        install_taps()
        installed = true
        print(string.format("[mame_playable_input_capture] installed taps, capture through f%d", last_frame))
    end

    frame_count = frame_count + 1

    capture_input_frame()
    local hits = capture_by_frame[frame_count]
    if hits ~= nil then
        for _, scenario in ipairs(hits) do
            table.insert(scenario.snapshots, capture_snapshot(scenario, frame_count))
            print(string.format(
                "[mame_playable_input_capture] %s captured frame %d (%d/%d)",
                scenario.name,
                frame_count,
                #scenario.snapshots,
                FRAME_COUNT + 1
            ))
        end
    end

    frame_reads = {}
    apply_input_for_frame(frame_count + 1)

    if frame_count >= last_frame then
        write_input_json()
        for _, scenario in ipairs(selected) do
            write_scenario(scenario)
        end
        manager.machine:exit()
    end
end)
