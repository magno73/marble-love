-- mame_obj38_trace.lua — write tap su slot0.W20 (abs 0x400038 word)
local function getenv(name, fallback)
    local v = os.getenv(name)
    if v == nil or v == "" then return fallback end
    return v
end

local LO        = tonumber(getenv("MARBLE_TRACE_LO", "0x40003c"))
local HI        = tonumber(getenv("MARBLE_TRACE_HI", "0x40003d"))
local FROM_FR   = tonumber(getenv("MARBLE_TRACE_FROM", "11960"))
local TO_FR     = tonumber(getenv("MARBLE_TRACE_TO", "12010"))
local OUT_PATH  = getenv("MARBLE_TRACE_OUT", "/tmp/mame_obj3c.json")
local MAX_SAMPLES = tonumber(getenv("MARBLE_TRACE_MAX_SAMPLES", "8000"))

local cpu, mem, cpu_pc
local frame_count = 0
local installed = false
local writes = 0
local writes_by_pc = {}
local s_f, s_pc, s_addr, s_data, s_mask = {}, {}, {}, {}, {}

local function install()
    mem:install_write_tap(LO, HI, "obj38_tap", function(o, d, m)
        writes = writes + 1
        local pc = cpu_pc.value
        writes_by_pc[pc] = (writes_by_pc[pc] or 0) + 1
        if writes <= MAX_SAMPLES then
            local i = writes
            s_f[i] = frame_count; s_pc[i] = pc
            s_addr[i] = o; s_data[i] = d; s_mask[i] = m
        end
    end)
end

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
        cpu_pc = cpu.state["PC"]
    end
    frame_count = frame_count + 1
    if frame_count == FROM_FR - 1 and not installed then
        install(); installed = true
        print(string.format("[obj38_tap] on 0x%X..0x%X frames=%d..%d", LO, HI, FROM_FR, TO_FR))
    end
    if frame_count > TO_FR then
        local pcs = {}
        for pc, c in pairs(writes_by_pc) do pcs[#pcs+1] = { pc = pc, count = c } end
        table.sort(pcs, function(a, b) return a.count > b.count end)
        local f = assert(io.open(OUT_PATH, "w"))
        f:write("{\n")
        f:write(string.format('  "total_writes": %d,\n', writes))
        f:write('  "writers_by_pc": [\n')
        for i, p in ipairs(pcs) do
            local sep = (i < #pcs) and "," or ""
            f:write(string.format('    {"pc": "0x%06x", "count": %d}%s\n', p.pc, p.count, sep))
        end
        f:write('  ],\n  "samples": [\n')
        local n = math.min(writes, MAX_SAMPLES)
        for i = 1, n do
            local sep = (i < n) and "," or ""
            f:write(string.format(
                '    {"f": %d, "pc": "0x%06x", "addr": "0x%06x", "data": "0x%08x", "mask": "0x%08x"}%s\n',
                s_f[i], s_pc[i], s_addr[i], s_data[i], s_mask[i], sep
            ))
        end
        f:write('  ]\n}\n'); f:close()
        print(string.format("[obj38_tap] DONE writes=%d -> %s", writes, OUT_PATH))
        manager.machine:exit()
    end
end)
