-- mame_ym2151_write_log.lua — log ogni (reg, val, cycle, pc) di write YM2151
-- in MAME. Pattern: write $1800 imposta selectedReg, write $1801 commit data.
-- Output JSON per diff con TS write log → identifica PRIMA divergenza.
local OUT_PATH = "/tmp/mame_ym_writes.json"
local TARGET_FRAME = tonumber(os.getenv("MARBLE_YM_TARGET") or "2000")
local audiocpu, sound_mem
local frame_count = 0
local installed = false
local tap_handles = {}
local writes = {}
local selectedReg = 0
local MAX_WRITES = 20000

local function record(reg, val, pc)
    if #writes >= MAX_WRITES then return end
    local t = manager.machine.time
    table.insert(writes, {
        reg = reg, val = val, pc = pc, frame = frame_count,
        secs = t.seconds, attos = t.attoseconds,
    })
end

emu.register_frame_done(function()
    if not installed then
        for _, t in ipairs({":audiocpu", ":soundcpu"}) do
            if manager.machine.devices[t] then audiocpu = manager.machine.devices[t]; break end
        end
        sound_mem = audiocpu.spaces["program"]
        table.insert(tap_handles, sound_mem:install_write_tap(0x1800, 0x1800, "ym_addr",
            function(o, d, m) selectedReg = d end))
        table.insert(tap_handles, sound_mem:install_write_tap(0x1801, 0x1801, "ym_data",
            function(o, d, m) record(selectedReg, d, audiocpu.state["PC"].value) end))
        installed = true
        print("[ym_writes] installed")
    end
    frame_count = frame_count + 1
    if frame_count >= TARGET_FRAME then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write("{\"writes\":[\n")
        for i, w in ipairs(writes) do
            local sep = (i < #writes) and "," or ""
            out:write(string.format(
                '  {"reg":"0x%02x","val":"0x%02x","pc":"0x%04x","frame":%d,"secs":%d,"attos":"%s"}%s\n',
                w.reg, w.val, w.pc, w.frame, w.secs, tostring(w.attos), sep))
        end
        out:write("]}\n")
        out:close()
        print(string.format("[ym_writes] saved %d writes", #writes))
        manager.machine:exit()
    end
end)
