-- mame_160f6_entry_tap.lua — entry tap for FUN_160F6 state dispatcher.
--
-- Captures the already-loaded A2/D1 state at PC 0x1612c, just after the
-- prologue has loaded the object pointer and prevTimer argument.

local function getenv(name, default)
    local v = os.getenv(name)
    if v == nil or v == "" then return default end
    return v
end

local FROM_FR = tonumber(getenv("MARBLE_TRACE_FROM", "14920"))
local TO_FR   = tonumber(getenv("MARBLE_TRACE_TO", "14960"))
local OUT_PATH = getenv("MARBLE_TRACE_OUT", "/tmp/mame_160f6_entry.json")
local MAX = tonumber(getenv("MARBLE_TRACE_MAX", "2000"))

local TAP_PC = 0x1612c
local OBJ0 = 0x400018

local cpu = nil
local mem = nil
local pc_state = nil
local frame_count = 0
local installed = false
local samples = {}

local function hx_region(addr, n)
    local t = {}
    for i = 0, n - 1 do
        t[#t + 1] = string.format("%02x", mem:read_u8(addr + i))
    end
    return table.concat(t)
end

local function add_sample()
    if frame_count < FROM_FR or frame_count > TO_FR then return end
    if pc_state.value ~= TAP_PC then return end
    if #samples >= MAX then return end
    local a2 = cpu.state["A2"].value
    if a2 ~= OBJ0 then return end
    samples[#samples + 1] = {
        f = frame_count,
        pc = pc_state.value,
        d1 = cpu.state["D1"].value,
        a2 = a2,
        obj = hx_region(OBJ0, 0x60),
        g660 = hx_region(0x400660, 0x50),
        struct = hx_region(0x401c28, 0x20),
    }
end

local function write_json()
    local f = assert(io.open(OUT_PATH, "w"))
    f:write("{\n")
    f:write(string.format('  "from_frame": %d,\n', FROM_FR))
    f:write(string.format('  "to_frame": %d,\n', TO_FR))
    f:write(string.format('  "total_samples": %d,\n', #samples))
    f:write('  "samples": [\n')
    for i, s in ipairs(samples) do
        local sep = (i < #samples) and "," or ""
        f:write(string.format(
            '    {"f":%d,"pc":"0x%06x","d1":"0x%08x","a2":"0x%06x","obj":"%s","g660":"%s","struct":"%s"}%s\n',
            s.f, s.pc, s.d1, s.a2, s.obj, s.g660, s.struct, sep
        ))
    end
    f:write("  ]\n")
    f:write("}\n")
    f:close()
end

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
        pc_state = cpu.state["PC"]
    end

    frame_count = frame_count + 1
    if frame_count == FROM_FR - 1 and not installed then
        mem:install_read_tap(TAP_PC, TAP_PC + 1, "state_dispatch_160f6_entry", function(o, d, m)
            add_sample()
        end)
        installed = true
        print(string.format("[160f6_entry] tap installed PC=0x%06x frames=%d..%d", TAP_PC, FROM_FR, TO_FR))
    end

    if frame_count > TO_FR then
        write_json()
        print(string.format("[160f6_entry] DONE samples=%d -> %s", #samples, OUT_PATH))
        manager.machine:exit()
    end
end)
