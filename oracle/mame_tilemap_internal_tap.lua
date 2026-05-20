local FROM_FR = tonumber(os.getenv("MARBLE_TRACE_FROM") or "15983")
local TO_FR = tonumber(os.getenv("MARBLE_TRACE_TO") or "15995")
local OUT_PATH = os.getenv("MARBLE_TRACE_OUT") or "/tmp/mame_tilemap_internal.json"
local MAX = tonumber(os.getenv("MARBLE_TRACE_MAX_SAMPLES") or "20000")

local PCS = {
    { pc = 0x01a444, name = "FUN_1A444" },
    { pc = 0x01ad54, name = "FUN_1AD54" },
    { pc = 0x01aa38, name = "FUN_1AA38" },
    { pc = 0x01a9cc, name = "FUN_1A9CC" },
}

local cpu, mem, pc_state, sp_state
local fc = 0
local installed = false
local seq = 0
local samples = {}

local function hx(v, width)
    return string.format("0x%0" .. tostring(width) .. "x", v or 0)
end

local function add_sample(name)
    if fc < FROM_FR or fc > TO_FR then return end
    if #samples >= MAX then return end
    seq = seq + 1
    local sp = sp_state.value
    local ok_ret, ret = pcall(function() return mem:read_u32(sp) end)
    samples[#samples + 1] = {
        f = fc,
        seq = seq,
        name = name,
        pc = pc_state.value,
        sp = sp,
        ret = ok_ret and ret or 0,
        d0 = cpu.state["D0"].value,
        d1 = cpu.state["D1"].value,
        d2 = cpu.state["D2"].value,
        d3 = cpu.state["D3"].value,
        d4 = cpu.state["D4"].value,
        a0 = cpu.state["A0"].value,
        a1 = cpu.state["A1"].value,
        a2 = cpu.state["A2"].value,
        a3 = cpu.state["A3"].value,
        pf_nz = 0,
        wr_a9c = mem:read_u8(0x400a9c),
        wr_1302 = mem:read_u8(0x401302),
        tick3f0 = mem:read_u8(0x4003f0),
    }
end

local function install_one(pc, name)
    mem:install_read_tap(pc, pc + 1, "tilemap_entry_" .. name, function()
        add_sample(name)
    end)
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
            '    {"f":%d,"seq":%d,"name":"%s","pc":"%s","sp":"%s","ret":"%s","d0":"%s","d1":"%s","d2":"%s","d3":"%s","d4":"%s","a0":"%s","a1":"%s","a2":"%s","a3":"%s","wr_a9c":%d,"wr_1302":%d,"tick3f0":%d}%s\n',
            s.f, s.seq, s.name, hx(s.pc, 6), hx(s.sp, 6), hx(s.ret, 8),
            hx(s.d0, 8), hx(s.d1, 8), hx(s.d2, 8), hx(s.d3, 8), hx(s.d4, 8),
            hx(s.a0, 8), hx(s.a1, 8), hx(s.a2, 8), hx(s.a3, 8),
            s.wr_a9c, s.wr_1302, s.tick3f0, sep))
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
        for _, p in ipairs(PCS) do install_one(p.pc, p.name) end
        installed = true
        print(string.format("[tilemap_internal] taps installed frames=%d..%d", FROM_FR, TO_FR))
    end

    if fc > TO_FR then
        write_json()
        print(string.format("[tilemap_internal] DONE samples=%d -> %s", #samples, OUT_PATH))
        manager.machine:exit()
    end
end)
