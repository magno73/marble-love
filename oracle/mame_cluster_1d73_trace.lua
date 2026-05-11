-- mame_cluster_1d73_trace.lua — live write-tap su workRam region 0x401d70..0x401e6f
-- per identificare i PC writer al cluster drift @ 0x1d73..0x1e67 nella demo window.
--
-- NOTA MAME 0.286 bug: install_write_tap si auto-disabilita silenziosamente dopo
-- ~200 frame se installato all'avvio. Workaround: installare il tap UNA volta a
-- ridosso della window (qui a fc = FROM_FR - 1).
--
-- Env vars:
--   MARBLE_TRACE_LO   — region low (default 0x401d70)
--   MARBLE_TRACE_HI   — region high inclusive (default 0x401e6f)
--   MARBLE_TRACE_FROM — first frame to log (default 11998)
--   MARBLE_TRACE_TO   — last frame to log + exit (default 12099)
--   MARBLE_TRACE_OUT  — output JSON (default /tmp/mame_cluster_1d73.json)

local function getenv(name, fallback)
    local v = os.getenv(name)
    if v == nil or v == "" then return fallback end
    return v
end

local LO        = tonumber(getenv("MARBLE_TRACE_LO", "0x401d70"))
local HI        = tonumber(getenv("MARBLE_TRACE_HI", "0x401e6f"))
local FROM_FR   = tonumber(getenv("MARBLE_TRACE_FROM", "11998"))
local TO_FR     = tonumber(getenv("MARBLE_TRACE_TO", "12099"))
local OUT_PATH  = getenv("MARBLE_TRACE_OUT", "/tmp/mame_cluster_1d73.json")
local MAX_SAMPLES = tonumber(getenv("MARBLE_TRACE_MAX_SAMPLES", "8000"))

local cpu = nil
local mem = nil
local cpu_pc = nil
local cpu_sp = nil
local frame_count = 0
local installed = false
local writes = 0

-- Aggregated by PC.
local writes_by_pc = {}     -- pc -> count
local addrs_by_pc = {}      -- pc -> { addr -> count }
-- Sample buffer (preallocated numeric arrays — avoiding strings inside the
-- tap callback prevents MAME segfaults observed on long runs).
local s_f, s_pc, s_addr, s_data, s_mask = {}, {}, {}, {}, {}
-- SP @ frame boundary snapshot for stack analysis.
local sp_at = {}

local function install()
    mem:install_write_tap(LO, HI, "cluster_1d73", function(o, d, m)
        writes = writes + 1
        local pc = cpu_pc.value
        writes_by_pc[pc] = (writes_by_pc[pc] or 0) + 1
        local a = addrs_by_pc[pc]
        if a == nil then a = {}; addrs_by_pc[pc] = a end
        a[o] = (a[o] or 0) + 1
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
        cpu_sp = cpu.state["SP"]
    end

    frame_count = frame_count + 1

    if frame_count == FROM_FR - 1 and not installed then
        install()
        installed = true
        print(string.format("[cluster_1d73] tap on 0x%X..0x%X frames=%d..%d",
            LO, HI, FROM_FR, TO_FR))
    end

    -- snapshot SP at end of frame for stack analysis
    if frame_count >= FROM_FR and frame_count <= TO_FR then
        sp_at[frame_count] = cpu_sp.value
    end

    if frame_count % 2000 == 0 then
        print(string.format("[cluster_1d73] fc=%d writes=%d", frame_count, writes))
    end

    if frame_count > TO_FR then
        local pcs = {}
        for pc, c in pairs(writes_by_pc) do
            local uniq, maxc, maxa = 0, 0, 0
            for a, ac in pairs(addrs_by_pc[pc]) do
                uniq = uniq + 1
                if ac > maxc then maxc, maxa = ac, a end
            end
            pcs[#pcs+1] = {
                pc = pc, count = c,
                unique_addrs = uniq, top_addr = maxa, top_addr_count = maxc,
            }
        end
        table.sort(pcs, function(a, b) return a.count > b.count end)

        local f = assert(io.open(OUT_PATH, "w"))
        f:write("{\n")
        f:write(string.format('  "region_lo": "0x%x",\n', LO))
        f:write(string.format('  "region_hi": "0x%x",\n', HI))
        f:write(string.format('  "from_frame": %d,\n', FROM_FR))
        f:write(string.format('  "to_frame": %d,\n', TO_FR))
        f:write(string.format('  "total_writes": %d,\n', writes))
        f:write('  "sp_at_frame": {')
        local first = true
        for fr, sp in pairs(sp_at) do
            if not first then f:write(",") end
            f:write(string.format('"%d":"0x%x"', fr, sp))
            first = false
        end
        f:write("},\n")
        f:write('  "writers_by_pc": [\n')
        for i, p in ipairs(pcs) do
            local sep = (i < #pcs) and "," or ""
            f:write(string.format(
                '    {"pc": "0x%06x", "count": %d, "unique_addrs": %d, "top_addr": "0x%06x", "top_addr_count": %d}%s\n',
                p.pc, p.count, p.unique_addrs, p.top_addr, p.top_addr_count, sep
            ))
        end
        f:write('  ],\n')
        f:write('  "samples": [\n')
        local n = math.min(writes, MAX_SAMPLES)
        for i = 1, n do
            local sep = (i < n) and "," or ""
            f:write(string.format(
                '    {"f": %d, "pc": "0x%06x", "addr": "0x%06x", "data": "0x%08x", "mask": "0x%08x"}%s\n',
                s_f[i], s_pc[i], s_addr[i], s_data[i], s_mask[i], sep
            ))
        end
        f:write('  ]\n')
        f:write("}\n")
        f:close()
        print(string.format("[cluster_1d73] DONE writes=%d distinct_pcs=%d -> %s",
            writes, #pcs, OUT_PATH))
        manager.machine:exit()
    end
end)
