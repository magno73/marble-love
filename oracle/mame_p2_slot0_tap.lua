-- mame_p2_slot0_tap.lua - write-tap over three key regions to diagnose
-- la divergenza P2.slot0 (cluster 0x0640/0x0a00) nel range f12060..f12080.
--
-- Tappa:
--   1) 0x400A00..0x400A1F (32B)  — P2 slot pair header (loop FUN_158CC)
--   2) 0x400A20..0x400A3F (32B)  — P2.slot0 full struct (x_long+0xc, y_long+0x10,
--                                  z_long+0x14, vx/vy/vz, ecc.)
--   3) 0x40097C..0x40097F  (4B)  — `srtgt` / xscroll target
--
-- Output: JSON with writers_by_pc + samples by frame, identical in format to
-- mame_cluster_0640_writers.lua so the parser can be reused.
--
-- Env vars (default = window 12060..12080):
--   MARBLE_TRACE_FROM — first frame to log (default 12059)
--   MARBLE_TRACE_TO   — last frame to log + exit (default 12080)
--   MARBLE_TRACE_OUT  — output JSON (default /tmp/mame_p2_slot0_writers.json)

local function getenv(name, fallback)
    local v = os.getenv(name)
    if v == nil or v == "" then return fallback end
    return v
end

local FROM_FR    = tonumber(getenv("MARBLE_TRACE_FROM", "12059"))
local TO_FR      = tonumber(getenv("MARBLE_TRACE_TO", "12080"))
local OUT_PATH   = getenv("MARBLE_TRACE_OUT", "/tmp/mame_p2_slot0_writers.json")
local MAX_SAMPLES = tonumber(getenv("MARBLE_TRACE_MAX_SAMPLES", "60000"))

-- Region descriptors. Each entry: { lo, hi, label }.
local REGIONS = {
    { lo = 0x400A00, hi = 0x400A1F, label = "p2hdr"  },
    { lo = 0x400A20, hi = 0x400A3F, label = "p2slot0" },
    { lo = 0x40097C, hi = 0x40097F, label = "srtgt"  },
}

local cpu = nil
local mem = nil
local cpu_pc = nil
local cpu_sp = nil
local frame_count = 0
local installed = false
local writes = 0

local writes_by_pc = {}
local sizes_by_pc  = {}      -- pc -> { [size] = count }
local addrs_by_pc  = {}
local s_f, s_pc, s_addr, s_data, s_mask, s_sp, s_lbl = {}, {}, {}, {}, {}, {}, {}
local addr_first = {}

-- mask -> size in bytes (M68k: 0xff byte, 0xffff word, 0xffffffff long)
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

local function install_one(lo, hi, label)
    mem:install_write_tap(lo, hi, "p2_" .. label, function(o, d, m)
        if frame_count < FROM_FR or frame_count > TO_FR then return end
        writes = writes + 1
        local pc = cpu_pc.value
        writes_by_pc[pc] = (writes_by_pc[pc] or 0) + 1

        local sz = mask_to_size(m)
        local sbp = sizes_by_pc[pc]
        if sbp == nil then sbp = {}; sizes_by_pc[pc] = sbp end
        sbp[sz] = (sbp[sz] or 0) + 1

        local a = addrs_by_pc[pc]
        if a == nil then a = {}; addrs_by_pc[pc] = a end
        a[o] = (a[o] or 0) + 1

        if addr_first[o] == nil then addr_first[o] = frame_count end

        if writes <= MAX_SAMPLES then
            local i = writes
            s_f[i] = frame_count; s_pc[i] = pc
            s_addr[i] = o; s_data[i] = d; s_mask[i] = m
            s_sp[i] = cpu_sp.value
            s_lbl[i] = label
        end
    end)
end

local function install()
    for _, r in ipairs(REGIONS) do
        install_one(r.lo, r.hi, r.label)
    end
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
        print(string.format("[p2_slot0] taps installed; window=%d..%d",
            FROM_FR, TO_FR))
    end

    if frame_count % 2000 == 0 then
        print(string.format("[p2_slot0] fc=%d writes=%d", frame_count, writes))
    end

    if frame_count > TO_FR then
        local pcs = {}
        for pc, c in pairs(writes_by_pc) do
            local uniq, maxc, maxa = 0, 0, 0
            for a, ac in pairs(addrs_by_pc[pc]) do
                uniq = uniq + 1
                if ac > maxc then maxc, maxa = ac, a end
            end
            local sz_list = sizes_by_pc[pc] or {}
            local sb, sw, sl = sz_list[1] or 0, sz_list[2] or 0, sz_list[4] or 0
            pcs[#pcs+1] = {
                pc = pc, count = c,
                unique_addrs = uniq, top_addr = maxa, top_addr_count = maxc,
                sz_byte = sb, sz_word = sw, sz_long = sl,
            }
        end
        table.sort(pcs, function(a, b) return a.count > b.count end)

        local f = assert(io.open(OUT_PATH, "w"))
        f:write("{\n")
        f:write(string.format('  "from_frame": %d,\n', FROM_FR))
        f:write(string.format('  "to_frame": %d,\n', TO_FR))
        f:write(string.format('  "total_writes": %d,\n', writes))
        f:write('  "regions": [\n')
        for i, r in ipairs(REGIONS) do
            local sep = (i < #REGIONS) and "," or ""
            f:write(string.format('    {"lo": "0x%x", "hi": "0x%x", "label": "%s"}%s\n',
                r.lo, r.hi, r.label, sep))
        end
        f:write('  ],\n')
        f:write('  "writers_by_pc": [\n')
        for i, p in ipairs(pcs) do
            local sep = (i < #pcs) and "," or ""
            f:write(string.format(
                '    {"pc": "0x%06x", "count": %d, "unique_addrs": %d, "top_addr": "0x%06x", "top_addr_count": %d, "sz_byte": %d, "sz_word": %d, "sz_long": %d}%s\n',
                p.pc, p.count, p.unique_addrs, p.top_addr, p.top_addr_count,
                p.sz_byte, p.sz_word, p.sz_long, sep
            ))
        end
        f:write('  ],\n')
        f:write('  "addr_first_write_frame": {\n')
        local addrs = {}
        for a, _ in pairs(addr_first) do addrs[#addrs+1] = a end
        table.sort(addrs)
        for i, a in ipairs(addrs) do
            local sep = (i < #addrs) and "," or ""
            f:write(string.format('    "0x%06x": %d%s\n', a, addr_first[a], sep))
        end
        f:write('  },\n')
        f:write('  "samples": [\n')
        local n = math.min(writes, MAX_SAMPLES)
        for i = 1, n do
            local sep = (i < n) and "," or ""
            f:write(string.format(
                '    {"f": %d, "pc": "0x%06x", "addr": "0x%06x", "data": "0x%08x", "mask": "0x%08x", "size": %d, "sp": "0x%06x", "lbl": "%s"}%s\n',
                s_f[i], s_pc[i], s_addr[i], s_data[i], s_mask[i],
                mask_to_size(s_mask[i]), s_sp[i], s_lbl[i], sep
            ))
        end
        f:write('  ]\n')
        f:write("}\n")
        f:close()
        print(string.format("[p2_slot0] DONE writes=%d distinct_pcs=%d -> %s",
            writes, #pcs, OUT_PATH))
        manager.machine:exit()
    end
end)
