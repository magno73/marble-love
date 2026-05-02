-- dump_rng_state.lua — log dello stato RNG (0x4003A6) ad ogni frame.
-- Permette di validare il reimpl TS contro l'oracolo MAME.

local function getenv(n, fb) local v=os.getenv(n); return (v==nil or v=="") and fb or v end
local OUT_PATH    = getenv("MARBLE_LOVE_RNG_OUT", "/tmp/rng_state.txt")
local MAX_FRAMES  = tonumber(getenv("MARBLE_LOVE_MAX_FRAMES", "1200"))

local out = nil
local cpu, mem
local frame = 0

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
        out = assert(io.open(OUT_PATH, "w"))
        out:write("# frame  rng_state(0x4003A6, u16)\n")
    end

    local state = mem:read_u16(0x4003A6)
    out:write(string.format("%d  %d\n", frame, state))

    frame = frame + 1
    if frame >= MAX_FRAMES then
        out:close()
        manager.machine:exit()
    end
end)
