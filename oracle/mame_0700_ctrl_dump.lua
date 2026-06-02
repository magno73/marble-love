-- mame_0700_ctrl_dump.lua - dump 256 bytes from maincpu program space @ 0x7F0FB.
-- Validate hypothesis B5: TS reads all 0xFF because 0x70000-0x7FFFF
-- is not modeled, while MAME may have active mirrors/mappings.
--
-- Capture three temporal snapshots of cluster 0x7F0FB..0x7F1FA:
--   * frame 12001 (pre-body f12002, when MAME is about to call
--                  decodeBitstream1A668 with ctrlStream=0x7F0FB)
--   * frame 12002 (mid-body: state during decoder execution)
--   * frame 12003 (post-body modification trail)
--
-- Output JSON: /tmp/mame_0700_ctrl_dump.json (override via MARBLE_TRACE_OUT).
--
-- Then compare with marble_program.bin[0x7F0FB..0x7F1FA], expected all 0xFF
-- for hypothesis B5): if equal, ROM source is coherent; if different, MAME reads
-- from an alternative source (mirror, ext RAM, slapstic, scratch).
--
-- Captured ranges = 4 (beyond the cluster):
--   primary  0x07F0FB..0x07F1FA (256B, direct target)
--   adj_lo   0x07F000..0x07F0FA (251B, immediate context below)
--   adj_hi   0x07F1FB..0x07F2FA (256B, immediate context above)
--   zone     0x070000..0x07FFFF: only a 16B sample-test every 0x1000 (checks
--                                 uniformity of the "empty" zone)

local function getenv(name, fallback)
    local v = os.getenv(name)
    if v == nil or v == "" then return fallback end
    return v
end

local OUT_PATH    = getenv("MARBLE_TRACE_OUT", "/tmp/mame_0700_ctrl_dump.json")
local FRAMES      = { 12001, 12002, 12003 }
local STOP_FRAME  = 12005  -- exit after covering the 3 samples

local PRIMARY_LO  = 0x07F0FB
local PRIMARY_HI  = 0x07F1FA  -- inclusive, 256 bytes

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
    -- 16-byte sample every 0x1000 from 0x70000 to 0x7F000
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
