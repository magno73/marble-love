-- mame_keyon_stack_tap.lua - when a YM2151 KEY ON write occurs,
-- ($08 = slot mask != 0), dump il sound 6502 stack per identificare la
-- capture the call chain that led to that write.

local OUT_PATH = os.getenv("MARBLE_KEYON_OUT") or "/tmp/mame_keyon_stack.json"
local TARGET_FRAME = 13000
local COIN_FRAME = 1200
local START_FRAME = 1500
local PULSE_LEN = 15
local MAX_CAPTURES = 20

local audiocpu, sound_mem, ports
local frame_count = 0
local installed = false
local tap_handles = {}
local captures = {}
local current_reg = -1

local function in_pulse(f, s) return f >= s and f < s + PULSE_LEN end

emu.register_frame_done(function()
    if not installed then
        local main_mem = manager.machine.devices[":maincpu"].spaces["program"]
        for _, t in ipairs({":audiocpu", ":soundcpu"}) do
            if manager.machine.devices[t] then audiocpu = manager.machine.devices[t]; break end
        end
        sound_mem = audiocpu.spaces["program"]
        ports = manager.machine.ioport.ports
        table.insert(tap_handles, main_mem:install_read_tap(0xF60000, 0xF60003, "k_sw", function(o,d,m) return d end))
        table.insert(tap_handles, sound_mem:install_read_tap(0x1820, 0x1820, "k_coin", function(o,d,m) return d end))
        table.insert(tap_handles, sound_mem:install_write_tap(0x1000, 0x3FFF, "k_w", function(o, d, m)
            local masked = o & 0xD871
            if masked == 0x1800 then
                current_reg = d & 0xff
            elseif masked == 0x1801 and current_reg == 0x08 then
                local slot_mask = (d >> 3) & 0x0F
                if slot_mask ~= 0 and #captures < MAX_CAPTURES then
                    -- Capture stack: SP and 32 bytes at $100+SP+1
                    local sp = audiocpu.state["SP"] and audiocpu.state["SP"].value or 0
                    local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or 0
                    local a = audiocpu.state["A"] and audiocpu.state["A"].value or 0
                    local x = audiocpu.state["X"] and audiocpu.state["X"].value or 0
                    local y = audiocpu.state["Y"] and audiocpu.state["Y"].value or 0
                    local stack_bytes = {}
                    for i = 0, 31 do
                        local addr = 0x100 + ((sp + 1 + i) & 0xFF)
                        stack_bytes[i + 1] = string.format("%02x", sound_mem:read_u8(addr))
                    end
                    -- Capture zp $00-$3F for context
                    local zp = {}
                    for i = 0, 0x3F do
                        zp[i + 1] = string.format("%02x", sound_mem:read_u8(i))
                    end
                    table.insert(captures, {
                        frame = frame_count,
                        pc = pc, sp = sp, a = a, x = x, y = y,
                        key_data = d & 0xff,
                        stack = table.concat(stack_bytes),
                        zp = table.concat(zp),
                    })
                    print(string.format("[keyon] f%d PC=$%04x SP=$%02x data=$%02x (ch=%d mask=$%x)",
                        frame_count, pc, sp, d & 0xff, d & 7, slot_mask))
                end
            end
            return d
        end))
        installed = true
        print("[keyon] tap installed")
    end
    frame_count = frame_count + 1
    if ports[":1820"] and ports[":1820"].fields["Coin 1"] then
        ports[":1820"].fields["Coin 1"]:set_value(in_pulse(frame_count + 1, COIN_FRAME) and 1 or 0)
    end
    if ports[":F60000"] and ports[":F60000"].fields["1 Player Start"] then
        ports[":F60000"].fields["1 Player Start"]:set_value(in_pulse(frame_count + 1, START_FRAME) and 1 or 0)
    end
    if frame_count >= TARGET_FRAME or #captures >= MAX_CAPTURES then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write(string.format('{"frame":%d,"captures":[\n', frame_count))
        for i, c in ipairs(captures) do
            local sep = (i < #captures) and "," or ""
            out:write(string.format(
                '  {"frame":%d,"pc":"0x%04x","sp":"0x%02x","a":"0x%02x","x":"0x%02x","y":"0x%02x","keyData":"0x%02x","stack":"%s","zp":"%s"}%s\n',
                c.frame, c.pc, c.sp, c.a, c.x, c.y, c.key_data, c.stack, c.zp, sep))
        end
        out:write("]}\n")
        out:close()
        print(string.format("[keyon] saved %d captures", #captures))
        manager.machine:exit()
    end
end)
