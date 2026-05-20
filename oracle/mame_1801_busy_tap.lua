-- mame_1801_busy_tap.lua — log TUTTI i read di $1801 con cycle count assoluto
-- + log dei write a $1800/$1801 con cycle count. Permette di misurare la
-- busy duration reale di YM2151 in MAME (BUSY bit 7 timing post-write).
local OUT_PATH = "/tmp/mame_1801_busy.json"
local TARGET_FRAME = 800   -- boot init phase
local audiocpu, sound_mem
local frame_count = 0
local installed = false
local tap_handles = {}
local events = {}  -- list of {kind, addr, value, secs, attos, pc}
local MAX_EVENTS = 8000

local function record(kind, addr, val, pc)
    if #events >= MAX_EVENTS then return end
    local t = manager.machine.time
    table.insert(events, {
        kind = kind, addr = addr, value = val,
        secs = t.seconds, attos = t.attoseconds, pc = pc,
    })
end

emu.register_frame_done(function()
    if not installed then
        for _, t in ipairs({":audiocpu", ":soundcpu"}) do
            if manager.machine.devices[t] then audiocpu = manager.machine.devices[t]; break end
        end
        sound_mem = audiocpu.spaces["program"]
        table.insert(tap_handles, sound_mem:install_read_tap(0x1801, 0x1801, "r1801",
            function(o, d, m) record("R", 0x1801, d, audiocpu.state["PC"].value); return d end))
        table.insert(tap_handles, sound_mem:install_read_tap(0x1800, 0x1800, "r1800",
            function(o, d, m) record("R", 0x1800, d, audiocpu.state["PC"].value); return d end))
        table.insert(tap_handles, sound_mem:install_write_tap(0x1800, 0x1800, "w1800",
            function(o, d, m) record("W", 0x1800, d, audiocpu.state["PC"].value) end))
        table.insert(tap_handles, sound_mem:install_write_tap(0x1801, 0x1801, "w1801",
            function(o, d, m) record("W", 0x1801, d, audiocpu.state["PC"].value) end))
        installed = true
        print("[1801_busy] installed")
    end
    frame_count = frame_count + 1
    if frame_count >= TARGET_FRAME then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write("{\"events\":[\n")
        for i, e in ipairs(events) do
            local sep = (i < #events) and "," or ""
            out:write(string.format(
                '  {"k":"%s","a":"0x%04x","v":"0x%02x","pc":"0x%04x","secs":%d,"attos":"%s"}%s\n',
                e.kind, e.addr, e.value, e.pc, e.secs, tostring(e.attos), sep))
        end
        out:write("]}\n")
        out:close()
        print(string.format("[1801_busy] saved %d events", #events))
        manager.machine:exit()
    end
end)
