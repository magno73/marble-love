-- mame_gameplay_scenarios.lua — capture warm-seed gameplay scenarios.
--
-- Output: one JSON file per scenario under oracle/scenarios/gameplay/ by default.
-- Each file contains 101 consecutive snapshots: index 0 is the warm seed,
-- indexes 1..100 are the oracle frames for TS replay.
--
-- Environment:
--   MARBLE_SCENARIOS_OUT_DIR  output directory (default oracle/scenarios/gameplay)
--   MARBLE_SCENARIOS          optional CSV of scenario names to capture
--
-- Example:
--   MARBLE_SCENARIOS=level1_spawn \
--   mame marble -nothrottle -skip_gameinfo -plugin lua \
--     -script oracle/mame_gameplay_scenarios.lua

local OUT_DIR = os.getenv("MARBLE_SCENARIOS_OUT_DIR") or "oracle/scenarios/gameplay"
local ONLY_RAW = os.getenv("MARBLE_SCENARIOS") or ""
local FRAME_COUNT = 100

local SCENARIOS = {
    { name = "level1_spawn",    frame = 13500, description = "Marble spawn, gravity starts" },
    { name = "level1_early",    frame = 14120, description = "Stable early level 1 motion" },
    { name = "level1_midmap",   frame = 14500, description = "Marble mid-map" },
    { name = "level1_obstacle", frame = 15084, description = "Stable first obstacle warm seed" },
    { name = "level1_end",      frame = 15800, description = "Finish line approach" },
    { name = "level2_spawn",    frame = 16500, description = "Level 2 Aerial Race spawn" },
    { name = "level2_early",    frame = 17010, description = "Stable early level 2 warm seed" },
    { name = "intro_overlay",   frame = 9700,  description = "RACE THIS LEVEL IN overlay" },
}

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
    error("[mame_gameplay_scenarios] no scenarios selected")
end

os.execute(string.format("mkdir -p %q", OUT_DIR))

local cpu = nil
local mem = nil
local slapstic_dev = nil
local frame_count = 0
local last_frame = 0
local capture_by_frame = {}

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
    if mem.readv_u16 ~= nil then
        return mem:readv_u16(addr)
    end
    if mem.readv_u8 ~= nil then
        return ((mem:readv_u8(addr) << 8) | mem:readv_u8(addr + 1)) & 0xffff
    end
    if mem.read_direct_u16 ~= nil then
        return mem:read_direct_u16(addr)
    end
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

local function json_escape(s)
    return string.gsub(s, '[%z\1-\31\\"]', function(c)
        if c == "\\" then return "\\\\" end
        if c == '"' then return '\\"' end
        return string.format("\\u%04x", string.byte(c))
    end)
end

local function write_scenario(scenario)
    local path = OUT_DIR .. "/" .. scenario.name .. ".json"
    local out = assert(io.open(path, "w"))
    out:write("{\n")
    out:write(string.format('  "name": "%s",\n', json_escape(scenario.name)))
    out:write(string.format('  "description": "%s",\n', json_escape(scenario.description)))
    out:write(string.format('  "seedFrame": %d,\n', scenario.frame))
    out:write(string.format('  "oracleFrames": %d,\n', FRAME_COUNT))
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
    print(string.format("[mame_gameplay_scenarios] saved %s (%d snapshots)", path, #scenario.snapshots))
end

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
        for _, tag in ipairs({":slapstic", ":maincpu:slapstic", ":slapstic_103"}) do
            if manager.machine.devices[tag] ~= nil then
                slapstic_dev = manager.machine.devices[tag]
                print(string.format("[mame_gameplay_scenarios] slapstic device tag: %s", tag))
                break
            end
        end
        if slapstic_dev == nil then
            print("[mame_gameplay_scenarios] WARN: slapstic device not found")
        end
    end

    frame_count = frame_count + 1
    local hits = capture_by_frame[frame_count]
    if hits ~= nil then
        for _, scenario in ipairs(hits) do
            table.insert(scenario.snapshots, capture_snapshot(scenario, frame_count))
            print(string.format(
                "[mame_gameplay_scenarios] %s captured frame %d (%d/%d)",
                scenario.name,
                frame_count,
                #scenario.snapshots,
                FRAME_COUNT + 1
            ))
        end
    end

    if frame_count >= last_frame then
        for _, scenario in ipairs(selected) do
            write_scenario(scenario)
        end
        manager.machine:exit()
    end
end)
