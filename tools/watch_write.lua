-- watch_write.lua — installs a write tap on a workRam region and logs each
-- write (PC, addr, value, mask, frame).
--
-- Configuration via env:
--   MARBLE_WATCH_LO   low address (default 0x401EE0)
--   MARBLE_WATCH_HI   inclusive high address (default 0x401EFF)
--   MARBLE_WATCH_OUT  path file output (default /tmp/marble_writes.log)
--   MARBLE_WATCH_MAX  maximum number of logged events (default 5000)
--   MARBLE_LOVE_MAX_FRAMES  number of frames to emulate (default 100)
--
-- Usage:
--   MARBLE_WATCH_LO=0x401EE0 MARBLE_WATCH_HI=0x401EFF \
--     mame marble -rompath ./roms -window -nothrottle -skip_gameinfo \
--          -seconds_to_run 30 -autoboot_script tools/watch_write.lua \
--          -autoboot_delay 0

local function getenv(name, fallback)
    local v = os.getenv(name)
    if v == nil or v == "" then return fallback end
    return v
end

local LO = tonumber(getenv("MARBLE_WATCH_LO", "0x401EE0"))
local HI = tonumber(getenv("MARBLE_WATCH_HI", "0x401EFF"))
local OUT = getenv("MARBLE_WATCH_OUT", "/tmp/marble_writes.log")
local MAX = tonumber(getenv("MARBLE_WATCH_MAX", "5000"))
local MAX_FRAMES = tonumber(getenv("MARBLE_LOVE_MAX_FRAMES", "100"))
local FROM_FRAME = tonumber(getenv("MARBLE_WATCH_FROM_FRAME", "0"))

local out_f = io.open(OUT, "w")
if out_f == nil then
    print("[watch_write] cannot open output: " .. OUT)
    return
end
out_f:write(string.format(
    "# write-tap on 0x%X..0x%X, max=%d, frames=%d\n", LO, HI, MAX, MAX_FRAMES
))
out_f:flush()

local cpu = nil
local mem = nil
local frame_count = 0
local event_count = 0
local installed = false

local function install_tap()
    if installed then return end
    cpu = manager.machine.devices[":maincpu"]
    mem = cpu.spaces["program"]
    if mem == nil then
        print("[watch_write] no program space")
        return
    end
    -- install_write_tap(addrstart, addrend, name, callback)
    -- callback(offset, data, mask) — offset = absolute addr in this space
    mem:install_write_tap(LO, HI, "marble_watch", function(offset, data, mask)
        if event_count >= MAX then return end
        if frame_count < FROM_FRAME then return end
        local pc = cpu.state["PC"].value
        out_f:write(string.format(
            "frame=%d pc=0x%06x addr=0x%06x data=0x%08x mask=0x%08x\n",
            frame_count, pc, offset, data, mask
        ))
        event_count = event_count + 1
        if event_count % 100 == 0 then out_f:flush() end
    end)
    installed = true
    print(string.format("[watch_write] tap installed on 0x%X..0x%X", LO, HI))
end

emu.register_frame_done(function()
    if not installed then install_tap() end
    frame_count = frame_count + 1
    if frame_count >= MAX_FRAMES then
        out_f:flush()
        out_f:close()
        print(string.format(
            "[watch_write] %d frames done, %d events logged → %s",
            frame_count, event_count, OUT
        ))
        manager.machine:exit()
    end
end)
