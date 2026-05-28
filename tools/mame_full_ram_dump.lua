-- mame_full_ram_dump.lua — dumpa l'intera Work RAM (8 KB) ad intervalli.
--
--
-- Uso:
--   MARBLE_LOVE_RAM_DUMP_PATH=/tmp/ram.bin \
--   MARBLE_LOVE_RAM_DUMP_INTERVAL=30 \
--   MARBLE_LOVE_MAX_FRAMES=600 \
--   mame marble -window -nothrottle -skip_gameinfo -seconds_to_run 30 \
--       -rompath roms \
--       -autoboot_script tools/mame_full_ram_dump.lua

local function getenv(name, fb)
    local v = os.getenv(name)
    if v == nil or v == "" then return fb end
    return v
end

local OUT_PATH    = getenv("MARBLE_LOVE_RAM_DUMP_PATH", "/tmp/ram_dump.bin")
local INTERVAL    = tonumber(getenv("MARBLE_LOVE_RAM_DUMP_INTERVAL", "30"))
local MAX_FRAMES  = tonumber(getenv("MARBLE_LOVE_MAX_FRAMES", "600"))

local out = nil
local cpu = nil
local mem = nil
local frame = 0
local snaps_written = 0

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
        out = assert(io.open(OUT_PATH, "wb"))
    end

    if frame % INTERVAL == 0 then
        -- header per snapshot: frame number BE u16
        out:write(string.char((frame >> 8) & 0xFF, frame & 0xFF))
        -- 8 KB di RAM
        for offset = 0, 0x1FFF do
            out:write(string.char(mem:read_u8(0x400000 + offset)))
        end
        snaps_written = snaps_written + 1
    end

    frame = frame + 1
    if frame >= MAX_FRAMES then
        out:close()
        print(string.format(
            "[ram_dump] wrote %d snapshots (%d byte/each + 2 byte header) to %s",
            snaps_written, 0x2000, OUT_PATH
        ))
        manager.machine:exit()
    end
end)
