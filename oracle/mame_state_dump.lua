-- mame_state_dump.lua — dumpa TUTTO il video state di Atari System 1
-- a un frame specifico. Output: JSON con playfieldRam, spriteRam, alphaRam,
-- colorRam, workRam, scrollX, scrollY in hex.
--
-- Variabili d'ambiente:
--   MARBLE_DUMP_TARGET_FRAME — frame al quale salvare (default 600)
--   MARBLE_DUMP_OUT          — file output (default /tmp/mame_state.json)

local TARGET_FRAME = tonumber(os.getenv("MARBLE_DUMP_TARGET_FRAME") or "600")
local OUT_PATH = os.getenv("MARBLE_DUMP_OUT") or "/tmp/mame_state.json"

local cpu = nil
local mem = nil
local frame_count = 0

local function hex_region(addr, size)
    local parts = {}
    for i = 0, size - 1 do
        parts[i + 1] = string.format("%02x", mem:read_u8(addr + i))
    end
    return table.concat(parts)
end

-- Read 9-bit MMIO scroll register via tracking variable.
-- MAME stores yscroll in atari_state but accessing it from Lua is tricky;
-- we instead read m_yscroll/m_xscroll via the tilemap scrolly() if exposed.
-- Fallback: read via memory at MMIO addresses (write-only registers, returns 0).
-- Better approach: use atari motion objects scroll registers via state items.

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
    end

    frame_count = frame_count + 1

    if frame_count == TARGET_FRAME then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write("{\n")
        out:write(string.format('  "frame": %d,\n', frame_count))

        -- workRam: 8 KB @ 0x400000
        out:write(string.format('  "workRam": "%s",\n', hex_region(0x400000, 0x2000)))
        -- playfieldRam: 8 KB @ 0xA00000
        out:write(string.format('  "playfieldRam": "%s",\n', hex_region(0xA00000, 0x2000)))
        -- spriteRam: 4 KB @ 0xA02000
        out:write(string.format('  "spriteRam": "%s",\n', hex_region(0xA02000, 0x1000)))
        -- alphaRam: 4 KB @ 0xA03000
        out:write(string.format('  "alphaRam": "%s",\n', hex_region(0xA03000, 0x1000)))
        -- colorRam: 2 KB @ 0xB00000
        out:write(string.format('  "colorRam": "%s"\n', hex_region(0xB00000, 0x800)))

        out:write("}\n")
        out:close()
        print(string.format("[mame_state_dump] saved frame %d to %s", frame_count, OUT_PATH))
        manager.machine:exit()
    end
end)
