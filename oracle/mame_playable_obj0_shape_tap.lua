-- mame_playable_obj0_shape_tap.lua -- write tap for obj0 sprite-shape records.
--
-- Wraps mame_playable_input_capture.lua and records writes to a focused
-- work-RAM window, usually obj0+0x38..0x4f or obj0+0xa4..0xbb.

local function getenv_num(name, default)
    local v = os.getenv(name)
    if v == nil or v == "" then return default end
    if string.sub(v, 1, 2) == "0x" or string.sub(v, 1, 2) == "0X" then
        return tonumber(v)
    end
    return tonumber(v) or default
end

local FROM_FR = getenv_num("MARBLE_TRACE_FROM", 3650)
local TO_FR = getenv_num("MARBLE_TRACE_TO", 3665)
local LO = getenv_num("MARBLE_TRACE_LO", 0x400050)
local HI = getenv_num("MARBLE_TRACE_HI", 0x400067)
local OUT_PATH = os.getenv("MARBLE_TRACE_OUT") or "/tmp/mame_playable_obj0_shape_tap.json"
local MAX_SAMPLES = getenv_num("MARBLE_TRACE_MAX", 4000)

local cpu, mem, pc_state, sp_state
local frame_count = 0
local installed = false
local written = false
local samples = {}
local writers_by_pc = {}

local function hx_region(addr, n)
    local out = {}
    for i = 0, n - 1 do
        out[#out + 1] = string.format("%02x", mem:read_u8(addr + i))
    end
    return table.concat(out)
end

local function add_sample(offset, data, mask)
    local pc = pc_state.value
    writers_by_pc[pc] = (writers_by_pc[pc] or 0) + 1
    if #samples >= MAX_SAMPLES then return end
    samples[#samples + 1] = {
        f = frame_count,
        pc = pc,
        sp = sp_state.value,
        addr = offset,
        data = data,
        mask = mask,
        obj38 = hx_region(0x400050, 0x30),
        obja4 = hx_region(0x4000bc, 0x30),
    }
end

local function install()
    mem:install_write_tap(LO, HI, "playable_obj0_shape_tap", function(offset, data, mask)
        if frame_count < FROM_FR or frame_count > TO_FR then return end
        add_sample(offset, data, mask)
    end)
end

local function write_json()
    if written then return end
    written = true
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
    f:write(string.format('  "total_samples": %d,\n', #samples))
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
            '    {"f":%d,"pc":"0x%06x","sp":"0x%06x","addr":"0x%06x","data":"0x%08x","mask":"0x%08x","obj38":"%s","obja4":"%s"}%s\n',
            row.f, row.pc, row.sp, row.addr, row.data, row.mask, row.obj38, row.obja4, sep
        ))
    end
    f:write("  ]\n")
    f:write("}\n")
    f:close()
    print(string.format("[playable_obj0_shape_tap] DONE samples=%d -> %s", #samples, OUT_PATH))
end

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
        pc_state = cpu.state["PC"]
        sp_state = cpu.state["SP"]
    end

    frame_count = frame_count + 1
    if frame_count == FROM_FR - 1 and not installed then
        install()
        installed = true
        print(string.format("[playable_obj0_shape_tap] installed 0x%06X..0x%06X at frame %d", LO, HI, frame_count))
    end

    if frame_count > TO_FR then
        write_json()
    end
end)

dofile("oracle/mame_playable_input_capture.lua")
