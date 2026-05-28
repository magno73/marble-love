-- mame_irq4_tap.lua — diagnostica IRQ4 interleaving vs body main thread.
--
-- Tappa:
--   1) ENTRY IRQ4 @ PC 0x34A (vector dispatch handler).
--   2) EXIT  IRQ4 @ PC 0x10144 (rte di MainTick @ 0x10116).
--   3) All writes to workRam 0x400000..0x401FFF while "in_irq" = true.
--
-- Output JSON with one entry per IRQ4 firing in frames [FROM, TO]:
--   { frame, idx, entry_pc, entry_t, exit_t, cycles,
--     pre_irq_pc (PC catturato all'entry, = body main thread before),
--     writes: [{ pc, addr, data, mask, size, off }] }
--
-- E aggregati:
--   - writes_by_off  (workRam offset -> count, top-PC, sample)
--   - writes_by_pc   (PC -> count, top-off)
--   - bodies_per_frame (n. IRQ4 firings per frame)
--   - cycles_in_irq_per_frame
--
-- Env vars:
--   MARBLE_TRACE_FROM = primo frame (default 12001)
--   MARBLE_TRACE_TO   = ultimo frame (default 12005)
--   MARBLE_TRACE_OUT  = path JSON (default /tmp/mame_irq4_trace.json)

local function getenv(name, fallback)
    local v = os.getenv(name)
    if v == nil or v == "" then return fallback end
    return v
end

local FROM_FR    = tonumber(getenv("MARBLE_TRACE_FROM", "12001"))
local TO_FR      = tonumber(getenv("MARBLE_TRACE_TO", "12005"))
local OUT_PATH   = getenv("MARBLE_TRACE_OUT", "/tmp/mame_irq4_trace.json")
local MAX_WRITES = tonumber(getenv("MARBLE_TRACE_MAX_WRITES", "200000"))
local CPU_CLOCK  = 7159090

local IRQ4_ENTRY = 0x000034A
local IRQ4_EXIT  = 0x00010144

local WORKRAM_LO = 0x400000
local WORKRAM_HI = 0x401FFF

local cpu, mem, cpu_pc
local fc = 0
local installed = false

local in_irq = false
local cur_irq = nil      -- { frame, idx, entry_pc, entry_t, pre_irq_pc }
local irq_idx = 0
local irq_list = {}      -- list of completed IRQs
local writes_count = 0

-- Aggregates
local writes_by_off = {} -- off -> { count, top_pc, top_pc_count, first_frame }
local writes_by_pc = {}  -- pc -> { count, offs={} }
local bodies_per_frame = {} -- frame -> count
local cycles_in_irq_per_frame = {} -- frame -> total cycles

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

local function time_now()
    local t = manager.machine.time
    return t.seconds + t.attoseconds / 1e18
end

local function install()
    -- ENTRY tap: read of opcode @ 0x34A means IRQ4 just got dispatched.
    -- (M68k auto-vector pushes SR+PC then loads vector → jumps to handler.)
    mem:install_read_tap(IRQ4_ENTRY, IRQ4_ENTRY + 1, "irq4_entry", function(o, d, m)
        if cpu_pc.value ~= IRQ4_ENTRY then return end
        if fc < FROM_FR or fc > TO_FR then return end
        if in_irq then return end -- defense
        in_irq = true
        irq_idx = irq_idx + 1
        cur_irq = {
            frame = fc,
            idx = irq_idx,
            entry_pc = cpu_pc.value,
            entry_t = time_now(),
            -- pre_irq_pc is NOT cpu_pc here — once we enter the handler PC == entry_pc.
            -- Capturing the "interrupted PC" requires reading the stack frame: at this point
            -- SP points to a 6-byte frame: [SR(2) PCh(2) PCl(2)]. So pre-irq PC = stack+2 long.
            writes = {},
        }
        local sp = cpu.state["SP"].value
        local pre_pc_hi = mem:read_u16(sp + 2)
        local pre_pc_lo = mem:read_u16(sp + 4)
        cur_irq.pre_irq_pc = ((pre_pc_hi & 0xffff) << 16) | (pre_pc_lo & 0xffff)
    end)

    -- EXIT tap: read of rte @ 0x10144 means MainTick is about to return from IRQ.
    mem:install_read_tap(IRQ4_EXIT, IRQ4_EXIT + 1, "irq4_exit", function(o, d, m)
        if cpu_pc.value ~= IRQ4_EXIT then return end
        if fc < FROM_FR or fc > TO_FR then return end
        if not in_irq or cur_irq == nil then return end
        local t1 = time_now()
        cur_irq.exit_t = t1
        cur_irq.cycles = math.floor((t1 - cur_irq.entry_t) * CPU_CLOCK + 0.5)
        irq_list[#irq_list + 1] = cur_irq
        bodies_per_frame[cur_irq.frame] = (bodies_per_frame[cur_irq.frame] or 0) + 1
        cycles_in_irq_per_frame[cur_irq.frame] =
            (cycles_in_irq_per_frame[cur_irq.frame] or 0) + cur_irq.cycles
        in_irq = false
        cur_irq = nil
    end)

    -- WRITE tap: log every workRam write while in_irq=true.
    mem:install_write_tap(WORKRAM_LO, WORKRAM_HI, "irq4_writes", function(o, d, m)
        if not in_irq or cur_irq == nil then return end
        if fc < FROM_FR or fc > TO_FR then return end
        writes_count = writes_count + 1
        local pc = cpu_pc.value
        local off = o - WORKRAM_LO
        local sz = mask_to_size(m)

        if #cur_irq.writes < 4096 then
            cur_irq.writes[#cur_irq.writes + 1] = {
                pc = pc, addr = o, data = d, mask = m, size = sz, off = off,
            }
        end

        -- by_off
        local bo = writes_by_off[off]
        if bo == nil then
            bo = { count = 0, top_pc = pc, top_pc_count = 0, first_frame = fc,
                   pcs = {} }
            writes_by_off[off] = bo
        end
        bo.count = bo.count + 1
        bo.pcs[pc] = (bo.pcs[pc] or 0) + 1
        if bo.pcs[pc] > bo.top_pc_count then
            bo.top_pc = pc
            bo.top_pc_count = bo.pcs[pc]
        end

        -- by_pc
        local bp = writes_by_pc[pc]
        if bp == nil then
            bp = { count = 0, offs = {} }
            writes_by_pc[pc] = bp
        end
        bp.count = bp.count + 1
        bp.offs[off] = (bp.offs[off] or 0) + 1
    end)
end

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
        cpu_pc = cpu.state["PC"]
    end

    fc = fc + 1

    if fc == FROM_FR - 1 and not installed then
        install()
        installed = true
        print(string.format("[irq4_tap] taps installed; window=%d..%d",
            FROM_FR, TO_FR))
    end

    if fc % 2000 == 0 then
        print(string.format("[irq4_tap] fc=%d irqs=%d writes=%d",
            fc, #irq_list, writes_count))
    end

    if fc > TO_FR then
        print(string.format("[irq4_tap] DONE; total irqs=%d writes=%d",
            #irq_list, writes_count))

        local f = assert(io.open(OUT_PATH, "w"))
        f:write("{\n")
        f:write(string.format('  "from_frame": %d,\n', FROM_FR))
        f:write(string.format('  "to_frame": %d,\n', TO_FR))
        f:write(string.format('  "cpu_clock_hz": %d,\n', CPU_CLOCK))
        f:write(string.format('  "irq4_entry": "0x%06x",\n', IRQ4_ENTRY))
        f:write(string.format('  "irq4_exit": "0x%06x",\n', IRQ4_EXIT))
        f:write(string.format('  "total_irqs": %d,\n', #irq_list))
        f:write(string.format('  "total_writes_in_irq": %d,\n', writes_count))

        -- bodies_per_frame
        f:write('  "bodies_per_frame": {\n')
        local frs = {}
        for k, _ in pairs(bodies_per_frame) do frs[#frs+1] = k end
        table.sort(frs)
        for i, fr in ipairs(frs) do
            local sep = (i < #frs) and "," or ""
            f:write(string.format('    "%d": %d%s\n', fr, bodies_per_frame[fr], sep))
        end
        f:write('  },\n')

        -- cycles_in_irq_per_frame
        f:write('  "cycles_in_irq_per_frame": {\n')
        for i, fr in ipairs(frs) do
            local sep = (i < #frs) and "," or ""
            f:write(string.format('    "%d": %d%s\n', fr,
                cycles_in_irq_per_frame[fr] or 0, sep))
        end
        f:write('  },\n')

        -- writes_by_off (sorted by count desc)
        local offs = {}
        for off, _ in pairs(writes_by_off) do offs[#offs+1] = off end
        table.sort(offs, function(a, b)
            return writes_by_off[a].count > writes_by_off[b].count
        end)
        f:write('  "writes_by_off": [\n')
        for i, off in ipairs(offs) do
            local sep = (i < #offs) and "," or ""
            local bo = writes_by_off[off]
            f:write(string.format(
                '    {"off": "0x%04x", "count": %d, "top_pc": "0x%06x", "top_pc_count": %d, "first_frame": %d}%s\n',
                off, bo.count, bo.top_pc, bo.top_pc_count, bo.first_frame, sep
            ))
        end
        f:write('  ],\n')

        -- writes_by_pc
        local pcs = {}
        for pc, _ in pairs(writes_by_pc) do pcs[#pcs+1] = pc end
        table.sort(pcs, function(a, b)
            return writes_by_pc[a].count > writes_by_pc[b].count
        end)
        f:write('  "writes_by_pc": [\n')
        for i, pc in ipairs(pcs) do
            local sep = (i < #pcs) and "," or ""
            local bp = writes_by_pc[pc]
            local uniq = 0
            for _, _ in pairs(bp.offs) do uniq = uniq + 1 end
            f:write(string.format(
                '    {"pc": "0x%06x", "count": %d, "unique_offs": %d}%s\n',
                pc, bp.count, uniq, sep
            ))
        end
        f:write('  ],\n')

        -- per-irq detail (only entry/exit/pre_irq + per-irq write count to keep size sane)
        f:write('  "irqs": [\n')
        for i, ir in ipairs(irq_list) do
            local sep = (i < #irq_list) and "," or ""
            local sample_writes = {}
            local nw = math.min(#ir.writes, 64)
            for j = 1, nw do
                local w = ir.writes[j]
                sample_writes[#sample_writes + 1] = string.format(
                    '      {"pc": "0x%06x", "off": "0x%04x", "data": "0x%08x", "size": %d}',
                    w.pc, w.off, w.data, w.size
                )
            end
            f:write(string.format(
                '    {"frame": %d, "idx": %d, "pre_irq_pc": "0x%06x", "cycles": %d, "n_writes": %d, "writes_sample": [\n%s\n    ]}%s\n',
                ir.frame, ir.idx, ir.pre_irq_pc, ir.cycles, #ir.writes,
                table.concat(sample_writes, ",\n"), sep
            ))
        end
        f:write('  ]\n')

        f:write("}\n")
        f:close()
        print(string.format("[irq4_tap] saved -> %s", OUT_PATH))
        manager.machine:exit()
    end
end)
