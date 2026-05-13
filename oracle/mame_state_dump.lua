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
local slapstic_dev = nil
local frame_count = 0

local function hex_region(addr, size)
    local parts = {}
    for i = 0, size - 1 do
        parts[i + 1] = string.format("%02x", mem:read_u8(addr + i))
    end
    return table.concat(parts)
end

local function read_current_bank()
    if slapstic_dev == nil then return -1 end
    local st = slapstic_dev.state
    if st ~= nil then
        local s = st["m_current_bank"]
        if s ~= nil then return s.value end
    end
    return -1
end

local BANK_FINGERPRINT_ADDRS = {0x81924, 0x81986, 0x81008, 0x80650}
local BANK_FINGERPRINTS = {
    {0x9f9c, 0xf01c, 0x80fc, 0x8440},
    {0x0000, 0x0000, 0xf058, 0xc049},
    {0x006e, 0x05e6, 0x2a66, 0x5747},
    {0x30a1, 0x35e6, 0x775d, 0xcc4b},
}

local function read_direct_word(addr)
    if mem == nil then return nil end
    if mem.readv_u16 ~= nil then
        return mem:readv_u16(addr)
    end
    if mem.readv_u8 ~= nil then
        return ((mem:readv_u8(addr) << 8) | mem:readv_u8(addr + 1)) & 0xffff
    end
    if mem.read_direct_u16 ~= nil then
        return mem:read_direct_u16(addr)
    end
    if mem.read_direct_u8 ~= nil then
        return ((mem:read_direct_u8(addr) << 8) | mem:read_direct_u8(addr + 1)) & 0xffff
    end
    return nil
end

local function infer_current_bank()
    local values = {}
    for i, addr in ipairs(BANK_FINGERPRINT_ADDRS) do
        local v = read_direct_word(addr)
        if v == nil then return -1 end
        values[i] = v
    end
    for bank = 1, 4 do
        local ok = true
        for i = 1, #BANK_FINGERPRINT_ADDRS do
            if values[i] ~= BANK_FINGERPRINTS[bank][i] then
                ok = false
                break
            end
        end
        if ok then return bank - 1 end
    end
    return -1
end

local function current_slapstic_bank()
    local bank = read_current_bank()
    if bank >= 0 then return bank end
    return infer_current_bank()
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
        for _, tag in ipairs({":slapstic", ":maincpu:slapstic", ":slapstic_103"}) do
            if manager.machine.devices[tag] ~= nil then
                slapstic_dev = manager.machine.devices[tag]
                print(string.format("[mame_state_dump] slapstic device tag: %s", tag))
                break
            end
        end
        if slapstic_dev == nil then
            print("[mame_state_dump] WARN: slapstic device not found")
        end
    end

    frame_count = frame_count + 1

    if frame_count == TARGET_FRAME then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write("{\n")
        out:write(string.format('  "frame": %d,\n', frame_count))
        out:write(string.format('  "slapsticBank": %d,\n', current_slapstic_bank()))

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
