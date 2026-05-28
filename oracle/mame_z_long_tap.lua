-- mame_z_long_tap.lua — log writes a obj0.z_long (workRam 0x40002c..0x40002f)
-- to identify PC + parent sub for the M68K writer that TS does not simulate.
--
-- Background: probe-z-override-experiment.ts showed that fixing
-- obj0.z_long closes 97B of gameplay drift (-47.5%). TS never updates
-- z_long (verified zero writes). This tap identifies who updates it in
-- MAME, so the behavior can be replicated.
--
-- Output: /tmp/mame_z_long_trace.json
-- Vars env:
--   MARBLE_TRACE_FROM (default 11998)
--   MARBLE_TRACE_TO   (default 12100)

local function getenv(name, default)
    local v = os.getenv(name)
    if v == nil or v == "" then return default end
    return v
end

local FROM_FR = tonumber(getenv("MARBLE_TRACE_FROM", "11998"))
local TO_FR   = tonumber(getenv("MARBLE_TRACE_TO",   "12100"))
local OUT_PATH = getenv("MARBLE_TRACE_OUT", "/tmp/mame_z_long_trace.json")
local MAX_SAMPLES = tonumber(getenv("MARBLE_TRACE_MAX_SAMPLES", "10000"))

local cpu = nil
local mem = nil
local cpu_pc = nil
local frame_count = 0
local installed = false

local s_f, s_pc, s_addr, s_data, s_mask, s_d_regs, s_a_regs = {}, {}, {}, {}, {}, {}, {}
local n_samples = 0
local n_writes = 0
local pc_counter = {}  -- PC → count

local function read_regs()
    local d, a = {}, {}
    for i = 0, 7 do
        d[i+1] = cpu.state[string.format("D%d", i)].value
        a[i+1] = cpu.state[string.format("A%d", i)].value
    end
    return d, a
end

local function install()
    mem:install_write_tap(0x40002c, 0x40002f, "z_long_write_log", function(o, d, m)
        if frame_count < FROM_FR or frame_count > TO_FR then return end
        n_writes = n_writes + 1
        local pc = cpu_pc.value
        pc_counter[pc] = (pc_counter[pc] or 0) + 1
        if n_samples < MAX_SAMPLES then
            n_samples = n_samples + 1
            s_f[n_samples]    = frame_count
            s_pc[n_samples]   = pc
            s_addr[n_samples] = o
            s_data[n_samples] = d
            s_mask[n_samples] = m
            local dr, ar = read_regs()
            s_d_regs[n_samples] = dr
            s_a_regs[n_samples] = ar
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
        install()
        installed = true
        print(string.format("[z_long_tap] tap installed frames=%d..%d on 0x40002c..0x40002f", FROM_FR, TO_FR))
    end

    if frame_count > TO_FR then
        local f = assert(io.open(OUT_PATH, "w"))
        f:write("{\n")
        f:write(string.format('  "from_frame": %d,\n', FROM_FR))
        f:write(string.format('  "to_frame": %d,\n', TO_FR))
        f:write(string.format('  "total_writes": %d,\n', n_writes))
        f:write('  "pc_counter": {')
        local first = true
        for pc, ct in pairs(pc_counter) do
            if not first then f:write(",") end
            f:write(string.format('"0x%06x":%d', pc, ct))
            first = false
        end
        f:write("},\n")
        f:write('  "samples": [\n')
        for i = 1, n_samples do
            local sep = (i < n_samples) and "," or ""
            local d_str = {}
            local a_str = {}
            for j = 1, 8 do
                d_str[j] = string.format('"0x%x"', s_d_regs[i][j])
                a_str[j] = string.format('"0x%x"', s_a_regs[i][j])
            end
            f:write(string.format(
                '    {"f":%d,"pc":"0x%06x","addr":"0x%06x","data":"0x%08x","mask":"0x%08x","d":[%s],"a":[%s]}%s\n',
                s_f[i], s_pc[i], s_addr[i], s_data[i], s_mask[i],
                table.concat(d_str, ","), table.concat(a_str, ","), sep
            ))
        end
        f:write("  ]\n")
        f:write("}\n")
        f:close()
        print(string.format("[z_long_tap] DONE writes=%d samples=%d -> %s",
            n_writes, n_samples, OUT_PATH))
        manager.machine:exit()
    end
end)
