-- mame_music_init_trace.lua - when the sound 6502 writes zp $0E or $0F.
-- (= music pointer LO/HI set), captures:
--   1) current 6502 PC
--   2) Stack contents (return addresses of the call chain)
--   3) Music ID from zp $19
--   4) Frame number
--
-- Allows identifying the caller of $91A8 (music init routine) and
-- therefore the command-handler branch that TS takes differently.
--
-- Sound 6502 main routine $91A8 is UNREACHABLE from static JSR/JMP/data table
-- in ROM. Likely entry via RTS-trick (push addr-1, RTS) or
-- JMP indirect via a dynamically loaded zp pointer.
--
-- Env:
--   MARBLE_TRACE_TARGET — frame fino a cui catturare (default 13000)
--   MARBLE_TRACE_OUT    — JSON output (default /tmp/mame_music_init.json)
--   MARBLE_TRACE_MAX    — max captures (default 50)

local TARGET_FRAME = tonumber(os.getenv("MARBLE_TRACE_TARGET") or "13000")
local OUT_PATH = os.getenv("MARBLE_TRACE_OUT") or "/tmp/mame_music_init.json"
local MAX_CAPTURES = tonumber(os.getenv("MARBLE_TRACE_MAX") or "50")
local COIN_FRAME = 1200
local START_FRAME = 1500
local PULSE_LEN = 15

local audiocpu, sound_mem, ports
local frame_count = 0
local installed = false
local tap_handles = {}
local captures = {}

local function in_pulse(f, s) return f >= s and f < s + PULSE_LEN end

emu.register_frame_done(function()
    if not installed then
        local main_mem = manager.machine.devices[":maincpu"].spaces["program"]
        for _, t in ipairs({":audiocpu", ":soundcpu"}) do
            if manager.machine.devices[t] then audiocpu = manager.machine.devices[t]; break end
        end
        sound_mem = audiocpu.spaces["program"]
        ports = manager.machine.ioport.ports
        table.insert(tap_handles, main_mem:install_read_tap(0xF60000, 0xF60003, "mi_sw",
            function(o,d,m) return d end))
        table.insert(tap_handles, sound_mem:install_read_tap(0x1820, 0x1820, "mi_coin",
            function(o,d,m) return d end))

        -- Write tap su zp $0E e $0F (music pointer set)
        table.insert(tap_handles, sound_mem:install_write_tap(0x000E, 0x000F, "mi_w",
            function(o, d, m)
                if #captures < MAX_CAPTURES then
                    local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or 0
                    local sp = audiocpu.state["SP"] and audiocpu.state["SP"].value or 0
                    local a = audiocpu.state["A"] and audiocpu.state["A"].value or 0
                    local x = audiocpu.state["X"] and audiocpu.state["X"].value or 0
                    local y = audiocpu.state["Y"] and audiocpu.state["Y"].value or 0
                    -- Dump full stack ($0100-$01FF) for call chain analysis
                    local stack_bytes = {}
                    for i = 0, 255 do
                        stack_bytes[i + 1] = string.format("%02x", sound_mem:read_u8(0x100 + i))
                    end
                    -- Dump zp $00-$3F for state context
                    local zp = {}
                    for i = 0, 0x3F do
                        zp[i + 1] = string.format("%02x", sound_mem:read_u8(i))
                    end
                    table.insert(captures, {
                        frame = frame_count,
                        addr = o,
                        value = d & 0xff,
                        pc = pc, sp = sp, a = a, x = x, y = y,
                        stack = table.concat(stack_bytes),
                        zp = table.concat(zp),
                    })
                    if #captures <= 10 then
                        print(string.format("[mi_trace] f%d PC=$%04x SP=$%02x write $%04x=$%02x (A=$%02x X=$%02x Y=$%02x)",
                            frame_count, pc, sp, o, d & 0xff, a, x, y))
                    end
                end
                return d
            end))
        installed = true
        print("[mi_trace] tap installed on zp $0E/$0F")
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
        out:write(string.format('{"frame":%d,"captureCount":%d,"captures":[\n', frame_count, #captures))
        for i, c in ipairs(captures) do
            local sep = (i < #captures) and "," or ""
            out:write(string.format(
                '  {"frame":%d,"addr":"0x%04x","value":"0x%02x","pc":"0x%04x","sp":"0x%02x","a":"0x%02x","x":"0x%02x","y":"0x%02x","stack":"%s","zp":"%s"}%s\n',
                c.frame, c.addr, c.value, c.pc, c.sp, c.a, c.x, c.y, c.stack, c.zp, sep))
        end
        out:write("]}\n")
        out:close()
        print(string.format("[mi_trace] saved %d captures to %s", #captures, OUT_PATH))
        manager.machine:exit()
    end
end)
