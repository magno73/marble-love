-- mame_struct_1c28_tap.lua — log writes a STRUCT @ workRam 0x401c28..0x401c47
-- to identify PC + parent sub for the M68K writer that TS does not simulate.
--
-- Output: /tmp/mame_struct_1c28_trace.json
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
local OUT_PATH = getenv("MARBLE_TRACE_OUT", "/tmp/mame_struct_1c28_trace.json")
local MAX_SAMPLES = tonumber(getenv("MARBLE_TRACE_MAX_SAMPLES", "5000"))

local cpu = nil
local mem = nil
local cpu_pc = nil
local frame_count = 0
local installed = false

local n_samples = 0
local n_writes = 0
local pc_counter = {}  -- PC → count
local s_f, s_pc, s_addr, s_data = {}, {}, {}, {}

local function install()
    mem:install_write_tap(0x401c28, 0x401c47, "struct_1c28_write_log", function(o, d, m)
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
        print(string.format("[struct_1c28_tap] installed frames=%d..%d on 0x401c28..0x401c47", FROM_FR, TO_FR))
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
        for i = 1, math.min(n_samples, 500) do
            local sep = (i < math.min(n_samples, 500)) and "," or ""
            f:write(string.format(
                '    {"f":%d,"pc":"0x%06x","addr":"0x%06x","data":"0x%08x"}%s\n',
                s_f[i], s_pc[i], s_addr[i], s_data[i], sep
            ))
        end
        f:write("  ]\n")
        f:write("}\n")
        f:close()
        print(string.format("[struct_1c28_tap] DONE writes=%d samples=%d -> %s",
            n_writes, n_samples, OUT_PATH))
        manager.machine:exit()
    end
end)
