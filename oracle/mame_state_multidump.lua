-- mame_state_multidump.lua - dump Atari System 1 video state at consecutive or
-- spaced frames. Output is a JSON array of snapshots for validating TS
-- frame-by-frame evolution against the MAME oracle.
--
-- Env vars:
--   MARBLE_DUMP_FRAMES - CSV list of frames to capture (default 2400,2410,2420,2430,2440,2450,2460)
--   MARBLE_DUMP_OUT    - output file (default /tmp/mame_state_multi.json)
--
-- Example:
--   MARBLE_DUMP_FRAMES=2400,2401,2402,2403,2404,2405 \
--   MARBLE_DUMP_OUT=/tmp/mame_state_multi.json \
--   mame marble -plugin lua -script oracle/mame_state_multidump.lua

local FRAMES_RAW = os.getenv("MARBLE_DUMP_FRAMES") or "2400,2410,2420,2430,2440,2450,2460"
local OUT_PATH = os.getenv("MARBLE_DUMP_OUT") or "/tmp/mame_state_multi.json"

local TARGET_FRAMES = {}
local TARGET_SET = {}
for tok in string.gmatch(FRAMES_RAW, "([^,]+)") do
    local f = tonumber(tok)
    if f ~= nil then
        table.insert(TARGET_FRAMES, f)
        TARGET_SET[f] = true
    end
end
table.sort(TARGET_FRAMES)
local LAST_FRAME = TARGET_FRAMES[#TARGET_FRAMES]

local cpu = nil
local mem = nil
local slapstic_dev = nil
local frame_count = 0
local snapshots = {}

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

local function capture_frame(n)
    return string.format(
        '    {\n' ..
        '      "frame": %d,\n' ..
        '      "slapsticBank": %d,\n' ..
        '      "workRam": "%s",\n' ..
        '      "playfieldRam": "%s",\n' ..
        '      "spriteRam": "%s",\n' ..
        '      "alphaRam": "%s",\n' ..
        '      "colorRam": "%s"\n' ..
        '    }',
        n,
        current_slapstic_bank(),
        hex_region(0x400000, 0x2000),
        hex_region(0xA00000, 0x2000),
        hex_region(0xA02000, 0x1000),
        hex_region(0xA03000, 0x1000),
        hex_region(0xB00000, 0x800)
    )
end

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
        for _, tag in ipairs({":slapstic", ":maincpu:slapstic", ":slapstic_103"}) do
            if manager.machine.devices[tag] ~= nil then
                slapstic_dev = manager.machine.devices[tag]
                print(string.format("[mame_state_multidump] slapstic device tag: %s", tag))
                break
            end
        end
        if slapstic_dev == nil then
            print("[mame_state_multidump] WARN: slapstic device not found")
        end
    end

    frame_count = frame_count + 1

    if TARGET_SET[frame_count] then
        table.insert(snapshots, capture_frame(frame_count))
        print(string.format("[mame_state_multidump] captured frame %d (%d/%d)",
            frame_count, #snapshots, #TARGET_FRAMES))
    end

    if frame_count >= LAST_FRAME then
        local out = assert(io.open(OUT_PATH, "w"))
        out:write("{\n")
        out:write(string.format('  "frames": [%s],\n',
            table.concat({(function()
                local arr = {}
                for _, f in ipairs(TARGET_FRAMES) do table.insert(arr, tostring(f)) end
                return table.concat(arr, ", ")
            end)()})))
        out:write('  "snapshots": [\n')
        out:write(table.concat(snapshots, ",\n"))
        out:write("\n  ]\n")
        out:write("}\n")
        out:close()
        print(string.format("[mame_state_multidump] saved %d snapshots to %s",
            #snapshots, OUT_PATH))
        manager.machine:exit()
    end
end)
