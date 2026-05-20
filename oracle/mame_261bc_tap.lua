-- mame_261bc_tap.lua — entry/exit tap for FUN_261BC velocity clamp.

local function getenv(name, default)
    local v = os.getenv(name)
    if v == nil or v == "" then return default end
    return v
end

local FROM_FR = tonumber(getenv("MARBLE_TRACE_FROM", "14920"))
local TO_FR   = tonumber(getenv("MARBLE_TRACE_TO", "14960"))
local OUT_PATH = getenv("MARBLE_TRACE_OUT", "/tmp/mame_261bc_tap.json")
local MAX = tonumber(getenv("MARBLE_TRACE_MAX", "4000"))

local PC_ENTRY = 0x261c8
local PC_EXIT  = 0x262ac
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

local function add_sample(phase)
    if frame_count < FROM_FR or frame_count > TO_FR then return end
    if #samples >= MAX then return end
    local a2 = cpu.state["A2"].value
    if a2 ~= OBJ0 then return end
    samples[#samples + 1] = {
        f = frame_count,
        phase = phase,
        pc = pc_state.value,
        d0 = cpu.state["D0"].value,
        d2 = cpu.state["D2"].value,
        d3 = cpu.state["D3"].value,
        a2 = a2,
        obj = hx_region(OBJ0, 0xd0),
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
            '    {"f":%d,"phase":"%s","pc":"0x%06x","d0":"0x%08x","d2":"0x%08x","d3":"0x%08x","a2":"0x%06x","obj":"%s"}%s\n',
            s.f, s.phase, s.pc, s.d0, s.d2, s.d3, s.a2, s.obj, sep
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
        mem:install_read_tap(PC_ENTRY, PC_ENTRY + 1, "fun261bc_entry", function(o, d, m)
            add_sample("entry")
        end)
        mem:install_read_tap(PC_EXIT, PC_EXIT + 1, "fun261bc_exit", function(o, d, m)
            add_sample("exit")
        end)
        installed = true
        print(string.format("[261bc_tap] installed PCs=0x%06x/0x%06x frames=%d..%d", PC_ENTRY, PC_EXIT, FROM_FR, TO_FR))
    end

    if frame_count > TO_FR then
        write_json()
        print(string.format("[261bc_tap] DONE samples=%d -> %s", #samples, OUT_PATH))
        manager.machine:exit()
    end
end)
