-- mame_0700_ctrl_dump.lua — dump 256 byte da maincpu program space @ 0x7F0FB
-- per validare l'ipotesi B5: TS legge tutto 0xFF perche' la zona 0x70000-0x7FFFF
-- non e' modellata, mentre MAME potrebbe avere mirror/mappature attive.
--
-- Cattura tre snapshot temporali del cluster 0x7F0FB..0x7F1FA:
--   * frame 12001 (pre-body f12002 — momento in cui MAME sta per chiamare
--                  decodeBitstream1A668 con ctrlStream=0x7F0FB)
--   * frame 12002 (mid-body — stato durante l'esecuzione del decoder)
--   * frame 12003 (post-body — eventuale modifica trail)
--
-- Output JSON: /tmp/mame_0700_ctrl_dump.json (override via MARBLE_TRACE_OUT).
--
-- Confronta poi con marble_program.bin[0x7F0FB..0x7F1FA] (atteso tutto 0xFF
-- per ipotesi B5): se uguali → ROM source coerente; se diversi → MAME legge
-- da sorgente alternativa (mirror, ext RAM, slapstic, scratch).
--
-- Range catturati = 4 (oltre il cluster):
--   primary  0x07F0FB..0x07F1FA (256B, target diretto)
--   adj_lo   0x07F000..0x07F0FA (251B, contesto immediato sotto)
--   adj_hi   0x07F1FB..0x07F2FA (256B, contesto immediato sopra)
--   zone     0x070000..0x07FFFF — solo 16B sample-test ogni 0x1000 (verifica
--                                 uniformita' della zona "vuota")

local function getenv(name, fallback)
    local v = os.getenv(name)
    if v == nil or v == "" then return fallback end
    return v
end

local OUT_PATH    = getenv("MARBLE_TRACE_OUT", "/tmp/mame_0700_ctrl_dump.json")
local FRAMES      = { 12001, 12002, 12003 }
local STOP_FRAME  = 12005  -- usciamo dopo aver coperto le 3 sample

local PRIMARY_LO  = 0x07F0FB
local PRIMARY_HI  = 0x07F1FA  -- inclusivo, 256 byte

local ADJ_LO_LO   = 0x07F000
local ADJ_LO_HI   = 0x07F0FA

local ADJ_HI_LO   = 0x07F1FB
local ADJ_HI_HI   = 0x07F2FA

local cpu = nil
local mem = nil
local frame_count = 0

local samples = {}  -- frame_num -> { primary=hex, adj_lo=hex, adj_hi=hex, zone_samples={addr=hex,...} }
local done = false

local function read_hex(lo, hi)
    local parts = {}
    for a = lo, hi do
        parts[#parts+1] = string.format("%02x", mem:read_u8(a))
    end
    return table.concat(parts)
end

local function read_zone_samples()
    -- 16 byte sample ogni 0x1000 da 0x70000 a 0x7F000
    local zone = {}
    for base = 0x070000, 0x07F000, 0x1000 do
        zone[#zone+1] = { addr = base, hex = read_hex(base, base + 15) }
    end
    return zone
end

local function snapshot(fr)
    local s = {
        frame = fr,
        primary = read_hex(PRIMARY_LO, PRIMARY_HI),
        adj_lo  = read_hex(ADJ_LO_LO,  ADJ_LO_HI),
        adj_hi  = read_hex(ADJ_HI_LO,  ADJ_HI_HI),
        zone_samples = read_zone_samples(),
    }
    samples[#samples+1] = s
end

local function dump_json()
    local f = assert(io.open(OUT_PATH, "w"))
    f:write("{\n")
    f:write(string.format('  "primary_lo": "0x%x",\n', PRIMARY_LO))
    f:write(string.format('  "primary_hi": "0x%x",\n', PRIMARY_HI))
    f:write(string.format('  "primary_size": %d,\n', PRIMARY_HI - PRIMARY_LO + 1))
    f:write('  "snapshots": [\n')
    for i, s in ipairs(samples) do
        local sep = (i < #samples) and "," or ""
        f:write("    {\n")
        f:write(string.format('      "frame": %d,\n', s.frame))
        f:write(string.format('      "primary_hex": "%s",\n', s.primary))
        f:write(string.format('      "adj_lo_lo": "0x%x", "adj_lo_hi": "0x%x", "adj_lo_hex": "%s",\n',
            ADJ_LO_LO, ADJ_LO_HI, s.adj_lo))
        f:write(string.format('      "adj_hi_lo": "0x%x", "adj_hi_hi": "0x%x", "adj_hi_hex": "%s",\n',
            ADJ_HI_LO, ADJ_HI_HI, s.adj_hi))
        f:write('      "zone_samples": [\n')
        for j, z in ipairs(s.zone_samples) do
            local zsep = (j < #s.zone_samples) and "," or ""
            f:write(string.format('        {"addr": "0x%x", "hex": "%s"}%s\n', z.addr, z.hex, zsep))
        end
        f:write("      ]\n")
        f:write("    }" .. sep .. "\n")
    end
    f:write("  ]\n")
    f:write("}\n")
    f:close()
end

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
    end

    frame_count = frame_count + 1

    if frame_count % 2000 == 0 then
        print(string.format("[0700_ctrl] fc=%d", frame_count))
    end

    for _, target in ipairs(FRAMES) do
        if frame_count == target then
            snapshot(target)
            print(string.format("[0700_ctrl] snapshot taken @ frame %d", target))
            break
        end
    end

    if frame_count >= STOP_FRAME and not done then
        done = true
        dump_json()
        print(string.format("[0700_ctrl] DONE %d snapshots -> %s", #samples, OUT_PATH))
        manager.machine:exit()
    end
end)
