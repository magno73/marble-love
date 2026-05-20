-- mame_1bc88_collision_tap.lua — captures FUN_1BC88 collision branch context.

local function getenv(name, default)
    local v = os.getenv(name)
    if v == nil or v == "" then return default end
    return v
end

local FROM_FR = tonumber(getenv("MARBLE_TRACE_FROM", "14850"))
local TO_FR   = tonumber(getenv("MARBLE_TRACE_TO", "14860"))
local OUT_PATH = getenv("MARBLE_TRACE_OUT", "/tmp/mame_1bc88_collision.json")
local MAX = tonumber(getenv("MARBLE_TRACE_MAX", "1000"))

local TAP_PC = 0x1be22

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
    local a3 = cpu.state["A3"].value
    samples[#samples + 1] = {
        f = frame_count,
        pc = pc_state.value,
        a2 = a2,
        a3 = a3,
        d2 = cpu.state["D2"].value,
        d3 = cpu.state["D3"].value,
        d4 = cpu.state["D4"].value,
        d6 = cpu.state["D6"].value,
        a2obj = hx_region(a2, 0xe2),
        a3obj = hx_region(a3, 0xe2),
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
            '    {"f":%d,"pc":"0x%06x","a2":"0x%06x","a3":"0x%06x","d2":"0x%08x","d3":"0x%08x","d4":"0x%08x","d6":"0x%08x","a2obj":"%s","a3obj":"%s"}%s\n',
            s.f, s.pc, s.a2, s.a3, s.d2, s.d3, s.d4, s.d6, s.a2obj, s.a3obj, sep
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
        mem:install_read_tap(TAP_PC, TAP_PC + 1, "fun1bc88_collision", function(o, d, m)
            add_sample()
        end)
        installed = true
        print(string.format("[1bc88_collision] tap installed PC=0x%06x frames=%d..%d", TAP_PC, FROM_FR, TO_FR))
    end

    if frame_count > TO_FR then
        write_json()
        print(string.format("[1bc88_collision] DONE samples=%d -> %s", #samples, OUT_PATH))
        manager.machine:exit()
    end
end)
