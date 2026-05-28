-- mame_0700_first_body_tap.lua — write-tap MAME su 0x400700..0x40077F per la
-- finestra del primo body post-warm (default f12000..f12005).
--
-- Differenza vs mame_cluster_0706_trace.lua:
--  * window stretta (5 frame)
--  * capture registers A0-A7, D0-D7 at write time to reconstruct the
--    parametri passati al decoder
--  * region copre l'intero cluster 0x700..0x77F
--
-- Env vars:
--   MARBLE_TRACE_FROM — first frame to log (default 12000)
--   MARBLE_TRACE_TO   — last frame to log + exit (default 12005)
--   MARBLE_TRACE_OUT  — output JSON (default /tmp/mame_0700_first_body.json)

local function getenv(name, fallback)
    local v = os.getenv(name)
    if v == nil or v == "" then return fallback end
    return v
end

local LO        = 0x400700
local HI        = 0x40077F
local FROM_FR   = tonumber(getenv("MARBLE_TRACE_FROM", "12000"))
local TO_FR     = tonumber(getenv("MARBLE_TRACE_TO", "12005"))
local OUT_PATH  = getenv("MARBLE_TRACE_OUT", "/tmp/mame_0700_first_body.json")
local MAX_SAMPLES = tonumber(getenv("MARBLE_TRACE_MAX_SAMPLES", "20000"))

local cpu = nil
local mem = nil
local cpu_pc = nil
local cpu_sp = nil
local reg_a, reg_d = {}, {}

local frame_count = 0
local installed = false
local writes = 0

local writes_by_pc = {}
local addrs_by_pc = {}
local writes_by_frame = {}
local s_f, s_pc, s_addr, s_data, s_mask, s_sp = {}, {}, {}, {}, {}, {}
local s_a, s_d = {}, {}

local function mask_to_size(m)
    if m == nil then return 0 end
    if m == 0xff then return 1 end
    if m == 0xffff then return 2 end
    if m == 0xffffffff then return 4 end
    local s = 0
    local mm = m
    for _ = 1, 4 do
        if (mm & 0xff) ~= 0 then s = s + 1 end
        mm = mm >> 8
    end
    return s
end

local function install()
    mem:install_write_tap(LO, HI, "first_body_0700", function(o, d, m)
        if frame_count < FROM_FR or frame_count > TO_FR then return end
        writes = writes + 1
        writes_by_frame[frame_count] = (writes_by_frame[frame_count] or 0) + 1
        local pc = cpu_pc.value
        writes_by_pc[pc] = (writes_by_pc[pc] or 0) + 1
        local a = addrs_by_pc[pc]
        if a == nil then a = {}; addrs_by_pc[pc] = a end
        a[o] = (a[o] or 0) + 1

        if writes <= MAX_SAMPLES then
            local i = writes
            s_f[i] = frame_count
            s_pc[i] = pc
            s_addr[i] = o
            s_data[i] = d
            s_mask[i] = m
            s_sp[i] = cpu_sp.value
            local av, dv = {}, {}
            for k = 0, 7 do
                av[k+1] = reg_a[k].value
                dv[k+1] = reg_d[k].value
            end
            s_a[i] = av
            s_d[i] = dv
        end
    end)
end

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
        cpu_pc = cpu.state["PC"]
        cpu_sp = cpu.state["SP"]
        for k = 0, 7 do
            reg_a[k] = cpu.state[string.format("A%d", k)]
            reg_d[k] = cpu.state[string.format("D%d", k)]
        end
    end

    frame_count = frame_count + 1

    if frame_count == FROM_FR - 1 and not installed then
        install()
        installed = true
        print(string.format("[first_body_0700] tap installed on 0x%X..0x%X frames=%d..%d",
            LO, HI, FROM_FR, TO_FR))
    end

    if frame_count % 2000 == 0 then
        print(string.format("[first_body_0700] fc=%d writes=%d", frame_count, writes))
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
        f:write('  "writes_by_frame": {')
        local first = true
        for fr, c in pairs(writes_by_frame) do
            if not first then f:write(",") end
            f:write(string.format('"%d":%d', fr, c))
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
            local av = s_a[i]
            local dv = s_d[i]
            f:write(string.format(
                '    {"f":%d,"pc":"0x%06x","addr":"0x%06x","data":"0x%08x","mask":"0x%08x","size":%d,"sp":"0x%06x",' ..
                '"a":["0x%x","0x%x","0x%x","0x%x","0x%x","0x%x","0x%x","0x%x"],' ..
                '"d":["0x%x","0x%x","0x%x","0x%x","0x%x","0x%x","0x%x","0x%x"]}%s\n',
                s_f[i], s_pc[i], s_addr[i], s_data[i], s_mask[i],
                mask_to_size(s_mask[i]), s_sp[i],
                av[1], av[2], av[3], av[4], av[5], av[6], av[7], av[8],
                dv[1], dv[2], dv[3], dv[4], dv[5], dv[6], dv[7], dv[8],
                sep
            ))
        end
        f:write('  ]\n')
        f:write("}\n")
        f:close()
        print(string.format("[first_body_0700] DONE writes=%d distinct_pcs=%d -> %s",
            writes, #pcs, OUT_PATH))
        manager.machine:exit()
    end
end)
