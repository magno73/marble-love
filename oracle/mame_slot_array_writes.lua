-- mame_slot_array_writes.lua — write tap for the 4-slot script array.

local function getenv(name, fallback)
    local v = os.getenv(name)
    if v == nil or v == "" then return fallback end
    return v
end

local LO       = tonumber(getenv("MARBLE_TRACE_LO", "0x401302"))
local HI       = tonumber(getenv("MARBLE_TRACE_HI", "0x401481"))
local FROM_FR  = tonumber(getenv("MARBLE_TRACE_FROM", "11999"))
local TO_FR    = tonumber(getenv("MARBLE_TRACE_TO", "12100"))
local OUT_PATH = getenv("MARBLE_TRACE_OUT", "/tmp/mame_slot_array_writes.json")
local MAX      = tonumber(getenv("MARBLE_TRACE_MAX_SAMPLES", "20000"))

local cpu, mem, pc_state
local fc = 0
local installed = false
local n = 0
local sf, spc, sa, sd, sm = {}, {}, {}, {}, {}

local function install()
    mem:install_write_tap(LO, HI, "slot_array_w", function(o, d, m)
        if fc < FROM_FR or fc > TO_FR then return end
        n = n + 1
        if n <= MAX then
            sf[n] = fc
            spc[n] = pc_state.value
            sa[n] = o
            sd[n] = d
            sm[n] = m
        end
    end)
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
        print(string.format("[slot_array_w] tap on 0x%X..0x%X frames=%d..%d", LO, HI, FROM_FR, TO_FR))
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
        print(string.format("[slot_array_w] DONE writes=%d -> %s", n, OUT_PATH))
        manager.machine:exit()
    end
end)
