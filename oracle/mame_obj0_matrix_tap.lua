-- mame_obj0_matrix_tap.lua — minimal write tap for obj0 rotation matrix.

local function getenv_num(name, default)
    local v = os.getenv(name)
    if v == nil or v == "" then return default end
    if string.sub(v, 1, 2) == "0x" or string.sub(v, 1, 2) == "0X" then
        return tonumber(v)
    end
    return tonumber(v) or default
end

local FROM_FR = getenv_num("MARBLE_TRACE_FROM", 15360)
local TO_FR = getenv_num("MARBLE_TRACE_TO", 15372)
local LO = getenv_num("MARBLE_TRACE_LO", 0x40008c)
local HI = getenv_num("MARBLE_TRACE_HI", 0x4000bb)
local OUT_PATH = os.getenv("MARBLE_TRACE_OUT") or "/tmp/mame_obj0_matrix_tap.json"
local MAX = getenv_num("MARBLE_TRACE_MAX_SAMPLES", 20000)

local cpu, mem, pc_state, sp_state
local fc = 0
local installed = false
local n = 0
local samples = {}

local function install()
    mem:install_write_tap(LO, HI, "obj0_matrix_tap", function(addr, data, mask)
        if fc < FROM_FR or fc > TO_FR then return end
        n = n + 1
        if #samples < MAX then
            samples[#samples + 1] = {
                f = fc,
                pc = pc_state.value,
                sp = sp_state.value,
                addr = addr,
                data = data,
                mask = mask,
            }
        end
    end)
end

local function hx(v, width)
    return string.format("0x%0" .. tostring(width) .. "x", v or 0)
end

local function write_json()
    local f = assert(io.open(OUT_PATH, "w"))
    f:write("{\n")
    f:write(string.format('  "from_frame": %d,\n', FROM_FR))
    f:write(string.format('  "to_frame": %d,\n', TO_FR))
    f:write(string.format('  "lo": "%s",\n', hx(LO, 6)))
    f:write(string.format('  "hi": "%s",\n', hx(HI, 6)))
    f:write(string.format('  "total_writes": %d,\n', n))
    f:write('  "samples": [\n')
    for i, s in ipairs(samples) do
        local sep = (i < #samples) and "," or ""
        f:write(string.format(
            '    {"f":%d,"pc":"%s","sp":"%s","addr":"%s","data":"0x%08x","mask":"0x%08x"}%s\n',
            s.f, hx(s.pc, 6), hx(s.sp, 6), hx(s.addr, 6), s.data, s.mask, sep
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
        sp_state = cpu.state["SP"]
    end

    fc = fc + 1
    if fc == FROM_FR - 1 and not installed then
        install()
        installed = true
        print(string.format("[obj0_matrix_tap] installed 0x%06X..0x%06X frames=%d..%d", LO, HI, FROM_FR, TO_FR))
    end

    if fc > TO_FR then
        write_json()
        print(string.format("[obj0_matrix_tap] DONE writes=%d -> %s", n, OUT_PATH))
        manager.machine:exit()
    end
end)
