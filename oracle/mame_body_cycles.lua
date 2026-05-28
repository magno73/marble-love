-- mame_body_cycles.lua — misura cicli REALI di FUN_10FCE (body) per frame
-- in attract gameplay (frame 12000..12099).
--
-- MAME 0.286 limitation: the Lua API does not expose a direct cycle counter.
-- (`cpu.total_cycles`, `cpu.state["CYCLES"]` ritornano nil). Inoltre chiamare
-- (FUN_10FCE entry -> exit), with 2 taps that read `manager.machine.time`.
--
-- Tecnica:
--   - Tap entry @ 0x10FCE: registra t_entry = machine.time.as_double()
--   - Tap exit  @ 0x1101C: t_exit - t_entry → cicli @ 7,159,090 Hz
--   - Output: JSON with cycles per frame in [FROM_FR, TO_FR].
--
-- Env vars:
--   MARBLE_TRACE_FROM        = primo frame (default 12000)
--   MARBLE_TRACE_TO          = ultimo frame (default 12099)
--   MARBLE_TRACE_OUT         = path JSON (default /tmp/mame_body_cycles.json)

local function getenv(name, fallback)
    local v = os.getenv(name)
    if v == nil or v == "" then return fallback end
    return v
end

local FROM_FR    = tonumber(getenv("MARBLE_TRACE_FROM", "12000"))
local TO_FR      = tonumber(getenv("MARBLE_TRACE_TO", "12099"))
local OUT_PATH   = getenv("MARBLE_TRACE_OUT", "/tmp/mame_body_cycles.json")
local CPU_CLOCK  = 7159090

local BODY_ENTRY = 0x10FCE
local BODY_EXIT  = 0x1101C

local cpu, mem, cpu_pc
local fc = 0
local installed = false

-- Per-body record: { frame, cycles }
local bodies = {}
local entry_t = -1

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem  = cpu.spaces["program"]
        cpu_pc = cpu.state["PC"]
    end

    fc = fc + 1

    if fc == FROM_FR - 1 and not installed then
        mem:install_read_tap(BODY_ENTRY, BODY_ENTRY + 1, "body_e",
            function(o, d, m)
                if cpu_pc.value ~= BODY_ENTRY then return end
                if fc < FROM_FR or fc > TO_FR then return end
                if entry_t < 0 then
                    local t = manager.machine.time
                    entry_t = t.seconds + t.attoseconds / 1e18
                end
            end)
        mem:install_read_tap(BODY_EXIT, BODY_EXIT + 1, "body_x",
            function(o, d, m)
                if cpu_pc.value ~= BODY_EXIT then return end
                if fc < FROM_FR or fc > TO_FR then return end
                if entry_t < 0 then return end
                local t = manager.machine.time
                local now = t.seconds + t.attoseconds / 1e18
                local cycles = math.floor((now - entry_t) * CPU_CLOCK + 0.5)
                bodies[#bodies + 1] = { frame = fc, cycles = cycles }
                entry_t = -1
            end)
        installed = true
        print(string.format("[body_cycles] taps installed; window=%d..%d",
                            FROM_FR, TO_FR))
    end

    if fc % 2000 == 0 then
        print(string.format("[body_cycles] fc=%d bodies=%d", fc, #bodies))
    end

    if fc > TO_FR then
        local f = assert(io.open(OUT_PATH, "w"))
        f:write("{\n")
        f:write(string.format('  "cpu_clock_hz": %d,\n', CPU_CLOCK))
        f:write(string.format('  "from_frame": %d,\n', FROM_FR))
        f:write(string.format('  "to_frame": %d,\n', TO_FR))
        f:write(string.format('  "num_bodies": %d,\n', #bodies))

        local sorted = {}
        for i = 1, #bodies do sorted[i] = bodies[i].cycles end
        table.sort(sorted)
        local function pct(p)
            if #sorted == 0 then return 0 end
            local idx = math.max(1, math.min(#sorted,
                                              math.floor(#sorted * p + 0.5)))
            return sorted[idx]
        end
        f:write(string.format('  "min": %d,\n', sorted[1] or 0))
        f:write(string.format('  "max": %d,\n', sorted[#sorted] or 0))
        f:write(string.format('  "p50": %d,\n', pct(0.50)))
        f:write(string.format('  "p95": %d,\n', pct(0.95)))

        -- Count frames over CYCLES_PER_VBLANK (119316)
        local CPV = 119316
        local over = 0
        for i = 1, #sorted do if sorted[i] > CPV then over = over + 1 end end
        f:write(string.format('  "cycles_per_vblank": %d,\n', CPV))
        f:write(string.format('  "bodies_over_vblank": %d,\n', over))

        f:write('  "bodies": [\n')
        for i = 1, #bodies do
            local sep = (i < #bodies) and "," or ""
            f:write(string.format('    {"frame": %d, "cycles": %d}%s\n',
                                  bodies[i].frame, bodies[i].cycles, sep))
        end
        f:write('  ]\n')
        f:write("}\n")
        f:close()
        print(string.format("[body_cycles] DONE bodies=%d -> %s",
                            #bodies, OUT_PATH))
        manager.machine:exit()
    end
end)
