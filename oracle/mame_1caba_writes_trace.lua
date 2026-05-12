-- mame_1caba_writes_trace.lua — trace every write to STRUCT @ 0x401C28..0x401C47
-- during sub1CABA execution in the attract window. For each write log
-- PC, addr, data, frame, current_call_idx, plus the path-discriminator
-- (terrainCode if we can capture it at PC 0x1CB66 = move.w (A0,D1.w),D0).
--
-- Output: /tmp/mame_1caba_writes_trace.json

local function getenv(name, default)
    local v = os.getenv(name)
    if v == nil or v == "" then return default end
    return v
end

local FROM_FR = tonumber(getenv("MARBLE_TRACE_FROM", "11998"))
local TO_FR   = tonumber(getenv("MARBLE_TRACE_TO",   "12010"))
local OUT_PATH = getenv("MARBLE_TRACE_OUT", "/tmp/mame_1caba_writes_trace.json")
local MAX_SAMPLES = tonumber(getenv("MARBLE_MAX_SAMPLES", "5000"))

local cpu = nil
local mem = nil
local cpu_pc = nil
local frame_count = 0
local installed = false

local call_idx = 0
local inside_call = false
local samples = {}
local n_samples = 0

-- Tap PC 0x1cb60..0x1cb63 (after `move.w (A0,D1.w),D0` reading terrainCode)
-- to capture D0 at that point.
-- Address 0x1cb64 is post-instruction; we want to read at 0x1cb64 PC fetch.

local function read_regs()
    local d, a = {}, {}
    for i = 0, 7 do
        d[i+1] = cpu.state[string.format("D%d", i)].value
        a[i+1] = cpu.state[string.format("A%d", i)].value
    end
    return d, a
end

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
        cpu_pc = cpu.state["PC"]
    end

    frame_count = frame_count + 1

    if frame_count == FROM_FR - 1 and not installed then
        -- Entry tap
        mem:install_read_tap(0x1CABA, 0x1CABB, "1caba_entry_w", function(o, d)
            if frame_count < FROM_FR or frame_count > TO_FR then return d end
            if cpu_pc.value ~= 0x1CABA then return d end
            call_idx = call_idx + 1
            inside_call = true
            if n_samples < MAX_SAMPLES then
                n_samples = n_samples + 1
                samples[n_samples] = {
                    f = frame_count, call_idx = call_idx, kind = "ENTRY",
                    pc = cpu_pc.value,
                    tileX = mem:read_u16(0x400696),
                    tileY = mem:read_u16(0x400698),
                }
            end
            return d
        end)
        -- Exit tap (RTS at 0x1CC5E)
        mem:install_read_tap(0x1CC5E, 0x1CC5F, "1caba_exit_w", function(o, d)
            if frame_count < FROM_FR or frame_count > TO_FR then return d end
            if cpu_pc.value ~= 0x1CC5E then return d end
            if n_samples < MAX_SAMPLES then
                n_samples = n_samples + 1
                samples[n_samples] = {
                    f = frame_count, call_idx = call_idx, kind = "EXIT",
                    pc = cpu_pc.value,
                }
            end
            inside_call = false
            return d
        end)
        -- Write tap on STRUCT (only log when inside sub1CABA)
        mem:install_write_tap(0x401C28, 0x401C47, "struct_write_w", function(o, d, m)
            if frame_count < FROM_FR or frame_count > TO_FR then return end
            if not inside_call then return end
            if n_samples < MAX_SAMPLES then
                n_samples = n_samples + 1
                local dr, ar = read_regs()
                samples[n_samples] = {
                    f = frame_count, call_idx = call_idx, kind = "WRITE",
                    pc = cpu_pc.value, addr = o, data = d, mask = m,
                    d = dr, a = ar,
                }
            end
        end)
        -- Trap on terrainCode read at PC 0x1cb64 (right after move.w (A0,D1.w),D0)
        mem:install_read_tap(0x1cb64, 0x1cb65, "1caba_tc_w", function(o, d)
            if frame_count < FROM_FR or frame_count > TO_FR then return d end
            if cpu_pc.value ~= 0x1cb64 then return d end
            if not inside_call then return d end
            if n_samples < MAX_SAMPLES then
                n_samples = n_samples + 1
                local dr, ar = read_regs()
                samples[n_samples] = {
                    f = frame_count, call_idx = call_idx, kind = "TC",
                    pc = cpu_pc.value,
                    terrainCode = dr[1], -- D0
                    d4 = dr[5], d6 = dr[7],
                    a3 = ar[4], a4 = ar[5], a5 = ar[6], a6 = ar[7],
                }
            end
            return d
        end)
        installed = true
        print(string.format("[1caba_writes] installed frames=%d..%d", FROM_FR, TO_FR))
    end

    if frame_count > TO_FR then
        local f = assert(io.open(OUT_PATH, "w"))
        f:write("{\n")
        f:write(string.format('  "from_frame": %d, "to_frame": %d, "n_samples": %d,\n', FROM_FR, TO_FR, n_samples))
        f:write('  "samples": [\n')
        for i = 1, n_samples do
            local s = samples[i]
            local sep = (i < n_samples) and "," or ""
            local extras = ""
            if s.kind == "ENTRY" then
                extras = string.format(',"tileX":"0x%x","tileY":"0x%x"', s.tileX, s.tileY)
            elseif s.kind == "WRITE" then
                extras = string.format(',"addr":"0x%06x","data":"0x%08x","mask":"0x%08x"', s.addr, s.data, s.mask)
            elseif s.kind == "TC" then
                extras = string.format(',"terrainCode":"0x%08x","d4":"0x%08x","d6":"0x%08x","a3":"0x%08x","a4":"0x%08x","a5":"0x%08x","a6":"0x%08x"',
                    s.terrainCode, s.d4, s.d6, s.a3, s.a4, s.a5, s.a6)
            end
            f:write(string.format('    {"f":%d,"call":%d,"kind":"%s","pc":"0x%06x"%s}%s\n',
                s.f, s.call_idx, s.kind, s.pc, extras, sep))
        end
        f:write('  ]\n}\n')
        f:close()
        print(string.format("[1caba_writes] DONE samples=%d -> %s", n_samples, OUT_PATH))
        manager.machine:exit()
    end
end)
