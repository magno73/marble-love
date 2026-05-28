-- capture_boot_ram.lua - dump the 8KB Work RAM at frame 0 as a fixture.
--
-- Output: binary file at `MARBLE_LOVE_BOOT_RAM_PATH` containing exactly
-- 0x2000 bytes (8 KB), the contents of 0x400000-0x401FFF after MAME's first
-- main-loop cycle.
--
-- Uso:
--   MARBLE_LOVE_BOOT_RAM_PATH=traces/boot_ram_frame0.bin \
--   mame marble -window -nothrottle -skip_gameinfo -seconds_to_run 5 \
--       -rompath roms \
--       -autoboot_script tools/capture_boot_ram.lua

local function getenv(n, fb) local v=os.getenv(n); return (v==nil or v=="") and fb or v end
local OUT_PATH = getenv("MARBLE_LOVE_BOOT_RAM_PATH", "/tmp/boot_ram.bin")

local frame = 0

emu.register_frame_done(function()
    if frame == 0 then
        local mem = manager.machine.devices[":maincpu"].spaces["program"]
        local f = assert(io.open(OUT_PATH, "wb"))
        for offset = 0, 0x1FFF do
            f:write(string.char(mem:read_u8(0x400000 + offset)))
        end
        f:close()
        print(string.format("[capture_boot_ram] wrote 8192 byte to %s", OUT_PATH))
        manager.machine:exit()
    end
    frame = frame + 1
end)
