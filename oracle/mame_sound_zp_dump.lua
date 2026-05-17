-- mame_sound_zp_dump.lua — dump zero-page del sound 6502 a frame target.
-- Permette diff TS vs MAME del music sequencer state byte ($32/$33/$34) +
-- altri zp critici.

local TARGET_FRAMES_RAW = os.getenv("MARBLE_ZP_FRAMES") or "12000,12100,12200,12300,12400,12450,12480,12485,12490,12500"
local OUT_PATH = os.getenv("MARBLE_ZP_OUT") or "/tmp/mame_zp_dump.json"
local COIN_FRAME = 1200
local START_FRAME = 1500
local PULSE_LEN = 15

local frame_set = {}
local max_frame = 0
for tok in string.gmatch(TARGET_FRAMES_RAW, "([^,]+)") do
    local f = tonumber(tok)
    if f then
        frame_set[f] = true
        if f > max_frame then max_frame = f end
    end
end

local audiocpu, sound_mem
local ports
local frame_count = 0
local installed = false
local tap_handles = {}
local dumps = {}

local function in_pulse(f, s) return f >= s and f < s + PULSE_LEN end

emu.register_frame_done(function()
    if not installed then
        local main_mem = manager.machine.devices[":maincpu"].spaces["program"]
        for _, t in ipairs({":audiocpu", ":soundcpu"}) do
            if manager.machine.devices[t] then audiocpu = manager.machine.devices[t]; break end
        end
        sound_mem = audiocpu.spaces["program"]
        ports = manager.machine.ioport.ports
        table.insert(tap_handles, main_mem:install_read_tap(0xF60000, 0xF60003, "zp_sw", function(o,d,m) return d end))
        table.insert(tap_handles, sound_mem:install_read_tap(0x1820, 0x1820, "zp_coin", function(o,d,m) return d end))
        installed = true
        print(string.format("[zp_dump] installed; max frame=%d", max_frame))
    end
    frame_count = frame_count + 1
    if ports[":1820"] and ports[":1820"].fields["Coin 1"] then
        ports[":1820"].fields["Coin 1"]:set_value(in_pulse(frame_count + 1, COIN_FRAME) and 0 or 1)
    end
    if ports[":F60000"] and ports[":F60000"].fields["1 Player Start"] then
        ports[":F60000"].fields["1 Player Start"]:set_value(in_pulse(frame_count + 1, START_FRAME) and 1 or 0)
    end

    if frame_set[frame_count] then
        local zp = {}
        for i = 0, 0xFF do
            zp[i + 1] = string.format("%02x", sound_mem:read_u8(i))
        end
        table.insert(dumps, { frame = frame_count, zp = table.concat(zp) })
        print(string.format("[zp_dump] f%d captured (zp first 16: %s)", frame_count, table.concat(zp, ' ', 1, 16)))
    end

    if frame_count >= max_frame + 1 then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write(string.format('{"dumps": [\n'))
        for i, d in ipairs(dumps) do
            local sep = (i < #dumps) and "," or ""
            out:write(string.format('  {"frame":%d,"zp":"%s"}%s\n', d.frame, d.zp, sep))
        end
        out:write("]}\n")
        out:close()
        print(string.format("[zp_dump] %d dumps saved to %s", #dumps, OUT_PATH))
        manager.machine:exit()
    end
end)
