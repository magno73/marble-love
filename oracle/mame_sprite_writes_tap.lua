-- mame_sprite_writes_tap.lua — write tap for motion-object RAM windows.
--
-- Env:
--   MARBLE_TRACE_FROM  first frame to record (default 12000)
--   MARBLE_TRACE_TO    last frame to record/exit (default 12960)
--   MARBLE_TRACE_LO    absolute start address (default 0xA02000)
--   MARBLE_TRACE_HI    absolute inclusive end address (default 0xA0277F)
--   MARBLE_TRACE_OUT   output JSON path
--   MARBLE_TRACE_MAX   max sample rows

local function getenv_num(name, default)
    local v = os.getenv(name)
    if v == nil or v == "" then return default end
    if string.sub(v, 1, 2) == "0x" or string.sub(v, 1, 2) == "0X" then
        return tonumber(v)
    end
    return tonumber(v) or default
end

local FROM_FR = getenv_num("MARBLE_TRACE_FROM", 12000)
local TO_FR = getenv_num("MARBLE_TRACE_TO", 12960)
local LO = getenv_num("MARBLE_TRACE_LO", 0xA02000)
local HI = getenv_num("MARBLE_TRACE_HI", 0xA0277F)
local OUT_PATH = os.getenv("MARBLE_TRACE_OUT") or "/tmp/mame_sprite_writes_tap.json"
local MAX_SAMPLES = getenv_num("MARBLE_TRACE_MAX", 2000)

local cpu = nil
local mem = nil
local pc_state = nil
local frame_count = 0
local installed = false
local writes = 0
local writers_by_pc = {}
local samples = {}

local function install()
    mem:install_write_tap(LO, HI, "sprite_writes_tap", function(offset, data, mask)
        local pc = pc_state.value
        writes = writes + 1
        writers_by_pc[pc] = (writers_by_pc[pc] or 0) + 1
        if #samples < MAX_SAMPLES then
            samples[#samples + 1] = {
                f = frame_count,
                pc = pc,
                addr = offset,
                data = data,
                mask = mask,
            }
        end
    end)
end

local function write_json()
    local pcs = {}
    for pc, count in pairs(writers_by_pc) do
        pcs[#pcs + 1] = { pc = pc, count = count }
    end
    table.sort(pcs, function(a, b) return a.count > b.count end)

    local f = assert(io.open(OUT_PATH, "w"))
    f:write("{\n")
    f:write(string.format('  "from_frame": %d,\n', FROM_FR))
    f:write(string.format('  "to_frame": %d,\n', TO_FR))
    f:write(string.format('  "region_lo": "0x%06x",\n', LO))
    f:write(string.format('  "region_hi": "0x%06x",\n', HI))
    f:write(string.format('  "total_writes": %d,\n', writes))
    f:write('  "writers_by_pc": [\n')
    for i, row in ipairs(pcs) do
        local sep = (i < #pcs) and "," or ""
        f:write(string.format('    {"pc": "0x%06x", "count": %d}%s\n', row.pc, row.count, sep))
    end
    f:write("  ],\n")
    f:write('  "samples": [\n')
    for i, row in ipairs(samples) do
        local sep = (i < #samples) and "," or ""
        f:write(string.format(
            '    {"f": %d, "pc": "0x%06x", "addr": "0x%06x", "data": "0x%08x", "mask": "0x%08x"}%s\n',
            row.f, row.pc, row.addr, row.data, row.mask, sep
        ))
    end
    f:write("  ]\n")
    f:write("}\n")
    f:close()
end

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
        pc_state = cpu.state["PC"]
    end

    frame_count = frame_count + 1
    if (not installed) and frame_count >= FROM_FR then
        install()
        installed = true
        print(string.format("[sprite_writes_tap] installed 0x%06X..0x%06X at frame %d", LO, HI, frame_count))
    end

    if frame_count >= TO_FR then
        write_json()
        print(string.format("[sprite_writes_tap] DONE writes=%d -> %s", writes, OUT_PATH))
        manager.machine:exit()
    end
end)
