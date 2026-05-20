local OUT = os.getenv("MARBLE_LIVE_DOWN_OUT") or "/tmp/mame_live_down_probe.json"
local START_FRAME = tonumber(os.getenv("MARBLE_LIVE_DOWN_START") or "2045")
local END_FRAME = tonumber(os.getenv("MARBLE_LIVE_DOWN_END") or "3150")
local MMIO_DX = tonumber(os.getenv("MARBLE_LIVE_MMIO_DX") or "0")
local MMIO_DY = tonumber(os.getenv("MARBLE_LIVE_MMIO_DY") or "-8")
local MMIO_STEP_BIAS = tonumber(os.getenv("MARBLE_LIVE_MMIO_STEP_BIAS") or "1")

local cpu, mem, ports
local frame_count = 0
local rows = {}
local snapshots = {}
local events = {}
local trace_pc = os.getenv("MARBLE_LIVE_DOWN_TRACE_PC") == "1"
local trace_installed = false

local function read_u8(off)
    return mem:read_u8(0x400000 + off)
end

local function read_u16(off)
    return ((read_u8(off) << 8) | read_u8(off + 1)) & 0xffff
end

local function read_u32(off)
    return ((read_u16(off) << 16) | read_u16(off + 2)) & 0xffffffff
end

local function count_nonzero(addr, size)
    local n = 0
    for i = 0, size - 1 do
        if mem:read_u8(addr + i) ~= 0 then n = n + 1 end
    end
    return n
end

local function hex_region(addr, size)
    local parts = {}
    for i = 0, size - 1 do
        parts[i + 1] = string.format("%02x", mem:read_u8(addr + i))
    end
    return table.concat(parts)
end

local function trace_event(label)
    if not trace_pc then return end
    if frame_count < START_FRAME or frame_count > END_FRAME then return end
    if #events >= 2000 then return end
    local obj = 0x400018
    local sp = cpu.state["SP"].value
    table.insert(events, string.format(
        '{"frame":%d,"label":"%s","pc":%d,"sp":%d,' ..
        '"d0":%d,"d1":%d,"d4":%d,"a2":%d,' ..
        '"arg0":%d,"arg1":%d,"objType":%d,"timer":%d,"o20":%d,"o36":%d,' ..
        '"x":%d,"y":%d,"z":%d,"targetX":%d,"targetY":%d}',
        frame_count,
        label,
        cpu.state["PC"].value,
        sp,
        cpu.state["D0"].value,
        cpu.state["D1"].value,
        cpu.state["D4"].value,
        cpu.state["A2"].value,
        mem:read_u32(sp + 4),
        mem:read_u32(sp + 8),
        mem:read_u8(obj + 0x1a),
        mem:read_u8(obj + 0x57),
        mem:read_u16(obj + 0x20),
        mem:read_u8(obj + 0x36),
        mem:read_u32(obj + 0x0c),
        mem:read_u32(obj + 0x10),
        mem:read_u32(obj + 0x14),
        read_u32(0x462),
        read_u32(0x466)
    ))
end

local function install_trace_taps()
    if not trace_pc or trace_installed then return end
    print("[mame_live_down_probe] installing trace taps")
    local taps = {
        {0x121b8, "FUN_121B8"},
        {0x12490, "121B8_POST_Z_DRIFT"},
        {0x124c8, "121B8_CALL_25C74"},
        {0x1269e, "121B8_BOUNCE_BELOW"},
        {0x25bae, "FUN_25BAE"},
        {0x25c74, "FUN_25C74"},
        {0x1cd00, "FUN_1CD00"},
    }
    for _, t in ipairs(taps) do
        local pc = t[1]
        local label = t[2]
        mem:install_read_tap(pc, pc + 1, "trace_" .. label, function(o, d, m)
            if cpu.state["PC"].value == pc then trace_event(label) end
        end)
    end
    mem:install_write_tap(0x400032, 0x400033, "trace_obj0_state_write", function(o, data, mask)
        trace_event("WRITE_obj0_state")
    end)
    mem:install_write_tap(0x40006e, 0x40006f, "trace_obj0_xcoarse_write", function(o, data, mask)
        trace_event("WRITE_obj0_xcoarse")
    end)
    mem:install_write_tap(0x400462, 0x400469, "trace_target_write", function(o, data, mask)
        trace_event("WRITE_target")
    end)
    trace_installed = true
end

local function set_field(port_tag, field_name, value)
    if ports == nil then return end
    local port = ports[port_tag]
    if port ~= nil and port.fields[field_name] ~= nil then
        port.fields[field_name]:set_value(value & 0xff)
    end
end

local function set_button(port_tag, field_name, pressed)
    if ports == nil then return end
    local port = ports[port_tag]
    if port ~= nil and port.fields[field_name] ~= nil then
        port.fields[field_name]:set_value(pressed and 0 or 1)
    end
end

local function apply_input(next_frame)
    local coin = next_frame >= 60 and next_frame < 75
    local start = next_frame >= 180 and next_frame < 195
    set_button(":1820", "Coin 1", coin)
    set_button(":1820", "Left Coin", false)
    set_button(":1820", "Right Coin", false)
    set_button(":F60000", "1 Player Start", start)
    set_button(":F60000", "2 Players Start", false)

    if next_frame >= START_FRAME then
        local step = next_frame - START_FRAME + MMIO_STEP_BIAS
        local mmio_x = (8 + step * MMIO_DX) & 0xff
        local mmio_y = (8 + step * MMIO_DY) & 0xff
        local raw_x = ((mmio_x + mmio_y) >> 1) & 0xff
        local raw_y = ((mmio_x - mmio_y) >> 1) & 0xff
        set_field(":IN0", "Trackball X", raw_x)
        set_field(":IN1", "Trackball Y", raw_y)
    else
        set_field(":IN0", "Trackball X", 0)
        set_field(":IN1", "Trackball Y", 0)
    end
end

local function capture()
    local obj = 0x18
    table.insert(rows, string.format(
        '{"frame":%d,"state":%d,"mode":%d,"segment":%d,"scroll0":%d,"scroll2":%d,' ..
        '"dir":%d,"active":%d,"run":%d,"speed":%d,"accum":%d,"srtgt":%d,' ..
        '"objType":%d,"timer":%d,"x":%d,"y":%d,"z":%d,' ..
        '"o08":%d,"o18":%d,"o20":%d,"o2a":%d,"o2e":%d,"o30":%d,' ..
        '"o36":%d,"o56":%d,"o58":%d,"o5a":%d,"o5f":%d,"o60":%d,' ..
        '"g684":%d,"g688":%d,"g68c":%d,"g696":%d,"g698":%d,"g69e":%d,"g6a0":%d,' ..
        '"targetX":%d,"targetY":%d,"targetFilter":%d,"pfNonzero":%d}',
        frame_count,
        read_u16(0x390),
        read_u16(0x392),
        read_u8(0x3e4),
        read_u16(0x00),
        read_u16(0x02),
        read_u8(0x04),
        read_u8(0x06),
        read_u8(0x08),
        read_u8(0x0a),
        read_u16(0x0c),
        read_u32(0x97c),
        read_u8(obj + 0x1a),
        read_u8(obj + 0x57),
        read_u32(obj + 0x0c),
        read_u32(obj + 0x10),
        read_u32(obj + 0x14),
        read_u32(obj + 0x08),
        read_u8(obj + 0x18),
        read_u16(obj + 0x20),
        read_u32(obj + 0x2a),
        read_u16(obj + 0x2e),
        read_u16(obj + 0x30),
        read_u8(obj + 0x36),
        read_u8(obj + 0x56),
        read_u8(obj + 0x58),
        read_u32(obj + 0x5a),
        read_u8(obj + 0x5f),
        read_u8(obj + 0x60),
        read_u32(0x684),
        read_u32(0x688),
        read_u32(0x68c),
        read_u16(0x696),
        read_u16(0x698),
        read_u16(0x69e),
        read_u16(0x6a0),
        read_u32(0x462),
        read_u32(0x466),
        read_u8(0x472),
        count_nonzero(0xA00000, 0x2000)
    ))
    if frame_count == tonumber(os.getenv("MARBLE_LIVE_DOWN_SNAPSHOT") or "-1") then
        table.insert(snapshots, string.format(
            '{"frame":%d,"workRam":"%s","playfieldRam":"%s","spriteRam":"%s","alphaRam":"%s","colorRam":"%s"}',
            frame_count,
            hex_region(0x400000, 0x2000),
            hex_region(0xA00000, 0x2000),
            hex_region(0xA02000, 0x1000),
            hex_region(0xA03000, 0x1000),
            hex_region(0xB00000, 0x800)
        ))
    end
end

local function write_out()
    local out = assert(io.open(OUT, "w"))
    out:write("{\"frames\":[\n")
    out:write(table.concat(rows, ",\n"))
    out:write("\n],\"snapshots\":[\n")
    out:write(table.concat(snapshots, ",\n"))
    out:write("\n],\"events\":[\n")
    out:write(table.concat(events, ",\n"))
    out:write("\n]}\n")
    out:close()
    print("[mame_live_down_probe] wrote " .. OUT)
end

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
        ports = manager.machine.ioport.ports
        install_trace_taps()
    end

    frame_count = frame_count + 1
    if frame_count >= START_FRAME then
        mem:write_u8(0x400390, 0)
        mem:write_u8(0x400391, 0)
    end
    if frame_count >= START_FRAME and frame_count <= END_FRAME then
        capture()
    end
    apply_input(frame_count + 1)
    if frame_count >= END_FRAME then
        write_out()
        manager.machine:exit()
    end
end)
