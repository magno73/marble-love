-- mame_state_multidump.lua — dumpa video state di Atari System 1 a una serie
-- di frame consecutivi/spaziati. Output: JSON array di snapshot per validare
-- evoluzione TS frame-per-frame contro MAME oracle.
--
-- Variabili d'ambiente:
--   MARBLE_DUMP_FRAMES — lista CSV di frame da catturare (default 2400,2410,2420,2430,2440,2450,2460)
--   MARBLE_DUMP_OUT    — file output (default /tmp/mame_state_multi.json)
--
-- Esempio:
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
local frame_count = 0
local snapshots = {}

local function hex_region(addr, size)
    local parts = {}
    for i = 0, size - 1 do
        parts[i + 1] = string.format("%02x", mem:read_u8(addr + i))
    end
    return table.concat(parts)
end

local function capture_frame(n)
    return string.format(
        '    {\n' ..
        '      "frame": %d,\n' ..
        '      "workRam": "%s",\n' ..
        '      "playfieldRam": "%s",\n' ..
        '      "spriteRam": "%s",\n' ..
        '      "alphaRam": "%s",\n' ..
        '      "colorRam": "%s"\n' ..
        '    }',
        n,
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
