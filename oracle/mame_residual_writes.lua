-- mame_residual_writes.lua -- write tap for the current warm-drift residuals.

local function getenv(name, fallback)
    local v = os.getenv(name)
    if v == nil or v == "" then return fallback end
    return v
end

local FROM_FR  = tonumber(getenv("MARBLE_TRACE_FROM", "11999"))
local TO_FR    = tonumber(getenv("MARBLE_TRACE_TO", "12100"))
local OUT_PATH = getenv("MARBLE_TRACE_OUT", "/tmp/mame_residual_writes.json")
local MAX      = tonumber(getenv("MARBLE_TRACE_MAX_SAMPLES", "20000"))

local WATCH = {
    [0x4000d4] = true,
    [0x4000d5] = true,
    [0x4000d6] = true,
    [0x4000d7] = true,
    [0x4000dc] = true,
    [0x4000dd] = true,
    [0x400408] = true,
    [0x400409] = true,
    [0x40040a] = true,
    [0x40040b] = true,
    [0x4006f4] = true,
    [0x4006f5] = true,
    [0x4013f2] = true,
    [0x4013f3] = true,
    [0x401f56] = true,
    [0x401f57] = true,
}

local cpu, mem, pc_state
local fc = 0
local installed = false
local n = 0
local sf, spc, sa, sd, sm = {}, {}, {}, {}, {}

local function maybe_record(o, d, m)
    if fc < FROM_FR or fc > TO_FR then return end
    if not WATCH[o] then return end
    n = n + 1
    if n <= MAX then
        sf[n] = fc
        spc[n] = pc_state.value
        sa[n] = o
        sd[n] = d
        sm[n] = m
    end
end

local function install()
    mem:install_write_tap(0x400000, 0x401fff, "residual_w", maybe_record)
end

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
        pc_state = cpu.state["PC"]
    end

    fc = fc + 1
    if fc == FROM_FR - 1 and not installed then
        install()
        installed = true
        print(string.format("[residual_w] tap frames=%d..%d", FROM_FR, TO_FR))
    end

    if fc > TO_FR then
        local f = assert(io.open(OUT_PATH, "w"))
        f:write("{\n")
        f:write(string.format('  "from_frame": %d,\n', FROM_FR))
        f:write(string.format('  "to_frame": %d,\n', TO_FR))
        f:write(string.format('  "total_writes": %d,\n', n))
        f:write('  "samples": [\n')
        local lim = math.min(n, MAX)
        for i = 1, lim do
            local sep = (i < lim) and "," or ""
            f:write(string.format(
                '    {"f":%d,"pc":"0x%06x","addr":"0x%06x","data":%d,"mask":%d}%s\n',
                sf[i], spc[i], sa[i], sd[i], sm[i], sep))
        end
        f:write("  ]\n")
        f:write("}\n")
        f:close()
        print(string.format("[residual_w] DONE writes=%d -> %s", n, OUT_PATH))
        manager.machine:exit()
    end
end)
