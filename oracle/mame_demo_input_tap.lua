-- mame_demo_input_tap.lua — capture Marble Madness attract-mode MMIO input reads.
--
-- Default output:
--   oracle/scenarios/input/demo_attract.json
--
-- Environment:
--   MARBLE_INPUT_FROM   first absolute frame to capture (default 12000)
--   MARBLE_INPUT_TO     last absolute frame to capture, inclusive (default 13000)
--   MARBLE_INPUT_OUT    output JSON path
--
-- The trace records the low-byte MMIO values actually read by the 68010:
--   F20001/F20003/F20005/F20007 = rotated trackball P1X/P1Y/P2X/P2Y
--   F60001                     = switch low byte (START bits, VBLANK, test)
--   F40001..F4001F             = joystick/ADC range for negative evidence

local function getenv_num(name, default)
    local v = os.getenv(name)
    if v == nil or v == "" then return default end
    if string.sub(v, 1, 2) == "0x" or string.sub(v, 1, 2) == "0X" then
        return tonumber(v)
    end
    return tonumber(v) or default
end

local FROM_FRAME = getenv_num("MARBLE_INPUT_FROM", 12000)
local TO_FRAME = getenv_num("MARBLE_INPUT_TO", 13000)
local OUT_PATH = os.getenv("MARBLE_INPUT_OUT") or "oracle/scenarios/input/demo_attract.json"

local cpu = nil
local mem = nil
local frame_count = 0
local installed = false

local current = {}
local frame_reads = {}
local frames = {}
local totals = {}

local INPUT_DEFAULTS = {
    [0xF20001] = 0xff,
    [0xF20003] = 0xff,
    [0xF20005] = 0xff,
    [0xF20007] = 0xff,
    [0xF60001] = 0x6f,
}

for addr, value in pairs(INPUT_DEFAULTS) do
    current[addr] = value
end

local function ensure_dir(path)
    local dir = string.match(path, "^(.*)/[^/]+$")
    if dir ~= nil and dir ~= "" then
        os.execute(string.format("mkdir -p %q", dir))
    end
end

local function key(addr)
    return string.format("%06x", addr)
end

local function record_read(addr, data)
    local active_frame = frame_count + 1
    if active_frame < FROM_FRAME or active_frame > TO_FRAME then return end
    local value = data & 0xff
    current[addr] = value
    frame_reads[addr] = (frame_reads[addr] or 0) + 1
    totals[addr] = (totals[addr] or 0) + 1
end

local function install_tap(lo, hi, name)
    mem:install_read_tap(lo, hi, name, function(offset, data, mask)
        record_read(offset, data)
        return data
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

local function value(addr)
    if current[addr] ~= nil then return current[addr] end
    return 0xff
end

local function buttons_from_switch(v)
    local buttons = 0
    if (v & 0x01) == 0 then buttons = buttons | 0x01 end
    if (v & 0x02) == 0 then buttons = buttons | 0x02 end
    return buttons
end

local function capture_frame()
    local switches = value(0xF60001)
    table.insert(frames, string.format(
        '    {"frame":%d,"trackballX":%d,"trackballY":%d,"trackball2X":%d,"trackball2Y":%d,"switches":%d,"buttons":%d,"readCounts":%s}',
        frame_count,
        value(0xF20001),
        value(0xF20003),
        value(0xF20005),
        value(0xF20007),
        switches,
        buttons_from_switch(switches),
        read_count_json()
    ))
end

local function totals_json()
    local parts = {}
    local addrs = {}
    for addr, _ in pairs(totals) do table.insert(addrs, addr) end
    table.sort(addrs)
    for _, addr in ipairs(addrs) do
        table.insert(parts, string.format('    "%s": %d', key(addr), totals[addr]))
    end
    return "{\n" .. table.concat(parts, ",\n") .. "\n  }"
end

local function write_json()
    ensure_dir(OUT_PATH)
    local out = assert(io.open(OUT_PATH, "w"))
    out:write("{\n")
    out:write('  "schemaVersion": 1,\n')
    out:write('  "source": "mame",\n')
    out:write('  "name": "demo_attract",\n')
    out:write(string.format('  "startFrame": %d,\n', FROM_FRAME))
    out:write(string.format('  "endFrame": %d,\n', TO_FRAME))
    out:write(string.format('  "frameCount": %d,\n', #frames))
    out:write('  "addresses": {\n')
    out:write('    "trackballX": "0xf20001",\n')
    out:write('    "trackballY": "0xf20003",\n')
    out:write('    "trackball2X": "0xf20005",\n')
    out:write('    "trackball2Y": "0xf20007",\n')
    out:write('    "switches": "0xf60001",\n')
    out:write('    "adcRange": "0xf40000-0xf4001f"\n')
    out:write('  },\n')
    out:write('  "readTotals": ')
    out:write(totals_json())
    out:write(",\n")
    out:write('  "frames": [\n')
    out:write(table.concat(frames, ",\n"))
    out:write("\n  ]\n")
    out:write("}\n")
    out:close()
end

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
    end
    if not installed then
        install_tap(0xF20000, 0xF20007, "demo_input_trackball")
        install_tap(0xF40000, 0xF4001F, "demo_input_adc")
        install_tap(0xF60000, 0xF60003, "demo_input_switches")
        installed = true
        print(string.format("[mame_demo_input_tap] installed, capture f%d..f%d", FROM_FRAME, TO_FRAME))
    end

    frame_count = frame_count + 1

    if frame_count >= FROM_FRAME and frame_count <= TO_FRAME then
        capture_frame()
        if ((frame_count - FROM_FRAME) % 500) == 0 then
            print(string.format("[mame_demo_input_tap] captured frame %d (%d)", frame_count, #frames))
        end
        frame_reads = {}
    end

    if frame_count >= TO_FRAME then
        write_json()
        print(string.format("[mame_demo_input_tap] saved %d frames to %s", #frames, OUT_PATH))
        manager.machine:exit()
    end
end)
