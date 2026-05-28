-- mame_eventflag_0006_tap.lua - read/write tap on event-flag word 0x400006..0x400007.
--
-- Goal: identify all PCs that read/write the event-flag word
-- used by refreshHelper13EE6.tst.b @ 0x400006. The important part is the
-- CONSUMER (who does `lsr.w *0x400006` = FUN_2548 consumeEventFlag) and SETTER
-- writer that populates word 0x0100, likely audio CPU ack or IRQ handler.
--
-- Env vars (defaults target the cluster #1 demo window: cadence bug every 8 frames):
--   MARBLE_TAP_FROM   — first frame to log (default 12001)
--   MARBLE_TAP_TO     — last frame to log + exit (default 12010)
--   MARBLE_TAP_OUT    — output JSON (default /tmp/mame_ef6_trace.json)

local function getenv(name, fallback)
    local v = os.getenv(name)
    if v == nil or v == "" then return fallback end
    return v
end

local FROM_FR  = tonumber(getenv("MARBLE_TAP_FROM", "12001"))
local TO_FR    = tonumber(getenv("MARBLE_TAP_TO",   "12010"))
local OUT_PATH = getenv("MARBLE_TAP_OUT", "/tmp/mame_ef6_trace.json")
local MAX_SAMPLES = tonumber(getenv("MARBLE_TAP_MAX_SAMPLES", "20000"))

local LO = 0x400006
local HI = 0x400007

local cpu = nil
local mem = nil
local cpu_pc = nil
local cpu_sp = nil
local frame_count = 0
local installed = false

local reads = 0
local writes = 0

-- Aggregates by PC.
local reads_by_pc = {}
local writes_by_pc = {}
local read_addrs_by_pc = {}
local write_addrs_by_pc = {}

-- sample log (sequenziale)
local sr_f, sr_pc, sr_addr, sr_mask = {}, {}, {}, {}
local sw_f, sw_pc, sw_addr, sw_data, sw_mask = {}, {}, {}, {}, {}

-- snapshot del word *0x400006 a inizio frame e fine frame
local word_at_start = {}
local word_at_end = {}

local function read_word()
    return mem:read_u16(LO)
end

local function install()
    mem:install_write_tap(LO, HI, "ef6_w", function(o, d, m)
        writes = writes + 1
        local pc = cpu_pc.value
        writes_by_pc[pc] = (writes_by_pc[pc] or 0) + 1
        local a = write_addrs_by_pc[pc]
        if a == nil then a = {}; write_addrs_by_pc[pc] = a end
        a[o] = (a[o] or 0) + 1
        if writes <= MAX_SAMPLES then
            local i = writes
            sw_f[i] = frame_count; sw_pc[i] = pc
            sw_addr[i] = o; sw_data[i] = d; sw_mask[i] = m
        end
    end)

    mem:install_read_tap(LO, HI, "ef6_r", function(o, d, m)
        reads = reads + 1
        local pc = cpu_pc.value
        reads_by_pc[pc] = (reads_by_pc[pc] or 0) + 1
        local a = read_addrs_by_pc[pc]
        if a == nil then a = {}; read_addrs_by_pc[pc] = a end
        a[o] = (a[o] or 0) + 1
        if reads <= MAX_SAMPLES then
            local i = reads
            sr_f[i] = frame_count; sr_pc[i] = pc
            sr_addr[i] = o; sr_mask[i] = m
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
        print(string.format("[ef6_tap] taps on 0x%X..0x%X frames=%d..%d",
            LO, HI, FROM_FR, TO_FR))
    end

    if frame_count >= FROM_FR and frame_count <= TO_FR then
        word_at_end[frame_count] = read_word()
    end
    if frame_count >= FROM_FR - 1 and frame_count < TO_FR then
        word_at_start[frame_count + 1] = read_word()
    end

    if frame_count % 2000 == 0 then
        print(string.format("[ef6_tap] fc=%d reads=%d writes=%d", frame_count, reads, writes))
    end

    if frame_count > TO_FR then
        -- ranks
        local function ranks(by_pc, addrs_by_pc)
            local arr = {}
            for pc, c in pairs(by_pc) do
                local uniq, top_addr, top_c = 0, 0, 0
                for a, ac in pairs(addrs_by_pc[pc]) do
                    uniq = uniq + 1
                    if ac > top_c then top_c, top_addr = ac, a end
                end
                arr[#arr+1] = { pc=pc, count=c, unique=uniq, top_addr=top_addr, top_addr_count=top_c }
            end
            table.sort(arr, function(a, b) return a.count > b.count end)
            return arr
        end
        local r_rank = ranks(reads_by_pc, read_addrs_by_pc)
        local w_rank = ranks(writes_by_pc, write_addrs_by_pc)

        local f = assert(io.open(OUT_PATH, "w"))
        f:write("{\n")
        f:write(string.format('  "from_frame": %d,\n', FROM_FR))
        f:write(string.format('  "to_frame": %d,\n', TO_FR))
        f:write(string.format('  "total_reads": %d,\n', reads))
        f:write(string.format('  "total_writes": %d,\n', writes))

        f:write('  "word_at_start_of_frame": {')
        local first = true
        for fr, w in pairs(word_at_start) do
            if not first then f:write(",") end
            f:write(string.format('"%d":"0x%04x"', fr, w))
            first = false
        end
        f:write("},\n")

        f:write('  "word_at_end_of_frame": {')
        first = true
        for fr, w in pairs(word_at_end) do
            if not first then f:write(",") end
            f:write(string.format('"%d":"0x%04x"', fr, w))
            first = false
        end
        f:write("},\n")

        f:write('  "readers_by_pc": [\n')
        for i, p in ipairs(r_rank) do
            local sep = (i < #r_rank) and "," or ""
            f:write(string.format(
                '    {"pc": "0x%06x", "count": %d, "unique_addrs": %d, "top_addr": "0x%06x", "top_addr_count": %d}%s\n',
                p.pc, p.count, p.unique, p.top_addr, p.top_addr_count, sep
            ))
        end
        f:write('  ],\n')

        f:write('  "writers_by_pc": [\n')
        for i, p in ipairs(w_rank) do
            local sep = (i < #w_rank) and "," or ""
            f:write(string.format(
                '    {"pc": "0x%06x", "count": %d, "unique_addrs": %d, "top_addr": "0x%06x", "top_addr_count": %d}%s\n',
                p.pc, p.count, p.unique, p.top_addr, p.top_addr_count, sep
            ))
        end
        f:write('  ],\n')

        local nr = math.min(reads, MAX_SAMPLES)
        f:write('  "read_samples": [\n')
        for i = 1, nr do
            local sep = (i < nr) and "," or ""
            f:write(string.format(
                '    {"f": %d, "pc": "0x%06x", "addr": "0x%06x", "mask": "0x%08x"}%s\n',
                sr_f[i], sr_pc[i], sr_addr[i], sr_mask[i], sep
            ))
        end
        f:write('  ],\n')

        local nw = math.min(writes, MAX_SAMPLES)
        f:write('  "write_samples": [\n')
        for i = 1, nw do
            local sep = (i < nw) and "," or ""
            f:write(string.format(
                '    {"f": %d, "pc": "0x%06x", "addr": "0x%06x", "data": "0x%08x", "mask": "0x%08x"}%s\n',
                sw_f[i], sw_pc[i], sw_addr[i], sw_data[i], sw_mask[i], sep
            ))
        end
        f:write('  ]\n')

        f:write("}\n")
        f:close()
        print(string.format("[ef6_tap] DONE reads=%d writes=%d -> %s", reads, writes, OUT_PATH))
        manager.machine:exit()
    end
end)
