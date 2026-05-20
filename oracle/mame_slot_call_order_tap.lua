-- mame_slot_call_order_tap.lua — entry-order tap for 144E4/14C46/1493C windows.

local function getenv(name, fallback)
    local v = os.getenv(name)
    if v == nil or v == "" then return fallback end
    return v
end

local FROM_FR  = tonumber(getenv("MARBLE_TRACE_FROM", "15015"))
local TO_FR    = tonumber(getenv("MARBLE_TRACE_TO", "15040"))
local OUT_PATH = getenv("MARBLE_TRACE_OUT", "/tmp/mame_slot_call_order.json")
local MAX      = tonumber(getenv("MARBLE_TRACE_MAX_SAMPLES", "5000"))

local PCS = {
    { pc = 0x010392, name = "FUN_10392" },
    { pc = 0x010504, name = "FUN_10504" },
    { pc = 0x010fce, name = "FUN_10FCE" },
    { pc = 0x011452, name = "FUN_11452" },
    { pc = 0x012dfa, name = "FUN_12DFA" },
    { pc = 0x013068, name = "FUN_13068" },
    { pc = 0x013ee6, name = "FUN_13EE6" },
    { pc = 0x0143ee, name = "FUN_13EE6_pre144E4" },
    { pc = 0x0144e4, name = "FUN_144E4" },
    { pc = 0x014c46, name = "FUN_14C46" },
    { pc = 0x01493c, name = "FUN_1493C" },
    { pc = 0x016ec6, name = "FUN_16EC6" },
    { pc = 0x018e6c, name = "FUN_18E6C" },
    { pc = 0x018f46, name = "FUN_18F46" },
    { pc = 0x018fd0, name = "FUN_18FD0" },
    { pc = 0x01a444, name = "FUN_1A444" },
    { pc = 0x01a9cc, name = "FUN_1A9CC" },
    { pc = 0x01aa38, name = "FUN_1AA38" },
    { pc = 0x01ad54, name = "FUN_1AD54" },
}

local cpu, mem, pc_state, sp_state
local fc = 0
local installed = false
local n = 0
local samples = {}

local function hx(v, width)
    return string.format("0x%0" .. tostring(width) .. "x", v or 0)
end

local function add_sample(name)
    if fc < FROM_FR or fc > TO_FR then return end
    if #samples >= MAX then return end
    local sp = sp_state.value
    samples[#samples + 1] = {
        f = fc,
        seq = n,
        name = name,
        pc = pc_state.value,
        sp = sp,
        ret = mem:read_u32(sp),
        stack4 = mem:read_u32(sp + 4),
        stack8 = mem:read_u32(sp + 8),
        d0 = cpu.state["D0"].value,
        d1 = cpu.state["D1"].value,
        d2 = cpu.state["D2"].value,
        d3 = cpu.state["D3"].value,
        a0 = cpu.state["A0"].value,
        a1 = cpu.state["A1"].value,
        a2 = cpu.state["A2"].value,
        xscroll = mem:read_u16(0x400000),
        dir = mem:read_u8(0x400004),
        active = mem:read_u8(0x400006),
        run = mem:read_u8(0x400008),
        speed = mem:read_u8(0x40000a),
        accum = mem:read_u16(0x40000c),
        mode = mem:read_u16(0x400394),
        slotnr = mem:read_u16(0x400396),
        srtgt = mem:read_u32(0x40097c),
        slot1 = mem:read_u8(0x401302 + 0x60 + 0x18),
        slot2 = mem:read_u8(0x401302 + 0x120 + 0x18),
        slot3 = mem:read_u8(0x401302 + 0x180 + 0x18),
    }
end

local function install_one(pc, name)
    mem:install_read_tap(pc, pc + 1, "entry_" .. name, function(o, d, m)
        n = n + 1
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
            '    {"f":%d,"seq":%d,"name":"%s","pc":"%s","sp":"%s","ret":"%s","stack4":"%s","stack8":"%s","d0":"%s","d1":"%s","d2":"%s","d3":"%s","a0":"%s","a1":"%s","a2":"%s","xscroll":"%s","dir":%d,"active":%d,"run":%d,"speed":%d,"accum":"%s","mode":"%s","slotnr":"%s","srtgt":"%s","slot1":%d,"slot2":%d,"slot3":%d}%s\n',
            s.f, s.seq, s.name, hx(s.pc, 6), hx(s.sp, 6), hx(s.ret, 8),
            hx(s.stack4, 8), hx(s.stack8, 8), hx(s.d0, 8), hx(s.d1, 8),
            hx(s.d2, 8), hx(s.d3, 8), hx(s.a0, 8), hx(s.a1, 8), hx(s.a2, 8),
            hx(s.xscroll, 4), s.dir, s.active, s.run, s.speed, hx(s.accum, 4),
            hx(s.mode, 4), hx(s.slotnr, 4), hx(s.srtgt, 8), s.slot1, s.slot2, s.slot3, sep))
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
        print(string.format("[slot_call_order] taps installed frames=%d..%d", FROM_FR, TO_FR))
    end

    if fc > TO_FR then
        write_json()
        print(string.format("[slot_call_order] DONE samples=%d -> %s", #samples, OUT_PATH))
        manager.machine:exit()
    end
end)
