-- mame_690_trace.lua — write tap su 0x400690 (POS_X global)
local function getenv(name, fallback)
    local v = os.getenv(name)
    if v == nil or v == "" then return fallback end
    return v
end
local LO = tonumber(getenv("MARBLE_TRACE_LO", "0x400690"))
local HI = tonumber(getenv("MARBLE_TRACE_HI", "0x400691"))
local FROM_FR = tonumber(getenv("MARBLE_TRACE_FROM", "11998"))
local TO_FR = tonumber(getenv("MARBLE_TRACE_TO", "12010"))
local OUT_PATH = getenv("MARBLE_TRACE_OUT", "/tmp/mame_690.json")
local cpu, mem, cpu_pc, cpu_sp
local frame_count = 0
local installed = false
local writes = 0
local writes_by_pc = {}
local s_f, s_pc, s_addr, s_data, s_a0, s_a1, s_a2 = {}, {}, {}, {}, {}, {}, {}
local function install()
    mem:install_write_tap(LO, HI, "tap_690", function(o, d, m)
        writes = writes + 1
        local pc = cpu_pc.value
        writes_by_pc[pc] = (writes_by_pc[pc] or 0) + 1
        if writes <= 2000 then
            local i = writes
            s_f[i] = frame_count; s_pc[i] = pc
            s_addr[i] = o; s_data[i] = d
            -- snapshot A2 (a2 = obj/struct pointer of caller chain)
            s_a2[i] = cpu.state["A2"].value
        end
    end)
end
emu.register_frame_done(function()
    if cpu == nil then cpu = manager.machine.devices[":maincpu"]; mem = cpu.spaces["program"]; cpu_pc = cpu.state["PC"]; cpu_sp = cpu.state["SP"] end
    frame_count = frame_count + 1
    if frame_count == FROM_FR - 1 and not installed then install(); installed = true; print(string.format("[tap_690] on 0x%X..0x%X", LO, HI)) end
    if frame_count > TO_FR then
        local pcs = {}; for pc, c in pairs(writes_by_pc) do pcs[#pcs+1] = { pc = pc, count = c } end
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
        local n = math.min(writes, 2000)
        for i = 1, n do
            local sep = (i < n) and "," or ""
            f:write(string.format('    {"f": %d, "pc": "0x%06x", "addr": "0x%06x", "data": "0x%08x", "a2": "0x%08x"}%s\n', s_f[i], s_pc[i], s_addr[i], s_data[i], s_a2[i], sep))
        end
        f:write('  ]\n}\n'); f:close()
        print(string.format("[tap_690] DONE writes=%d -> %s", writes, OUT_PATH))
        manager.machine:exit()
    end
end)
