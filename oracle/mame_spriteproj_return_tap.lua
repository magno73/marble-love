-- mame_spriteproj_return_tap.lua - capture D0 register at PC 0x1242a (=
-- istruzione successiva a `jsr 0x1CC62; move.l D0,D4` in helper121B8).
-- A PC 0x1242a, D0 contiene il return value di spriteProject1CC62.
--
-- Compare with TS computation (= 0x3fdc_0000 with STRUCT warm all-3fdc) to
-- verify whether the TS replica is bit-perfect.
--
-- Output: /tmp/mame_spriteproj_return.json
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
local OUT_PATH = getenv("MARBLE_TRACE_OUT", "/tmp/mame_spriteproj_return.json")

-- PC right after `jsr 0x1cc62`. Disasm:
--   0x12422: clr.l -(SP)         ; push 0
--   0x12424: 4eb9 0001 cc62 = jsr $0001cc62.l
--   0x1242a: 2800              = move.l D0,D4
--   0x1242c: 588f              = addq.l #4,SP
--   0x1242e: 2f04              = move.l D4,-(SP)
-- We tap PC 0x1242a (= immediately post-jsr, before move.l D0,D4 executes).
local TAP_PC_POST_JSR = 0x1242a

local cpu = nil
local mem = nil
local frame_count = 0
local installed = false

local samples = {}
local n_samples = 0
local MAX = 1000

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
    end
    frame_count = frame_count + 1
    if frame_count == FROM_FR - 1 and not installed then
        -- Use install_read_tap on a no-op read at the PC after jsr.
        -- Alternative: use cpu.debugger:command(string.format("bpset %X,1,...", TAP_PC_POST_JSR))
        -- Simpler: tap on the prefetch read at TAP_PC_POST_JSR.
        mem:install_read_tap(TAP_PC_POST_JSR, TAP_PC_POST_JSR + 1, "spriteproj_post_jsr", function(o, d, m)
            if frame_count < FROM_FR or frame_count > TO_FR then return end
            if n_samples >= MAX then return end
            n_samples = n_samples + 1
            local d0 = cpu.state["D0"].value
            local objZ = mem:read_u32(0x40002c)
            local pc = cpu.state["PC"].value
            samples[n_samples] = {
                f = frame_count,
                pc = pc,
                addr = o,
                d0 = d0,
                obj_z = objZ,
            }
        end)
        installed = true
        print(string.format("[spriteproj_tap] installed at PC 0x%x, frames %d..%d", TAP_PC_POST_JSR, FROM_FR, TO_FR))
    end

    if frame_count > TO_FR then
        local f = assert(io.open(OUT_PATH, "w"))
        f:write("{\n")
        f:write(string.format('  "from_frame": %d, "to_frame": %d, "total_samples": %d,\n', FROM_FR, TO_FR, n_samples))
        f:write('  "samples": [\n')
        for i = 1, n_samples do
            local sep = (i < n_samples) and "," or ""
            f:write(string.format(
                '    {"f":%d,"pc":"0x%x","addr":"0x%x","d0":"0x%x","obj_z":"0x%x"}%s\n',
                samples[i].f, samples[i].pc, samples[i].addr, samples[i].d0, samples[i].obj_z, sep
            ))
        end
        f:write("  ]\n}\n")
        f:close()
        print(string.format("[spriteproj_tap] DONE samples=%d -> %s", n_samples, OUT_PATH))
        manager.machine:exit()
    end
end)
