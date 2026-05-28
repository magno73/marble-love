--
-- JSONL schema must stay in sync with `packages/engine/src/trace.ts`.
--
-- Usage from the run_oracle.ts wrapper:
--   mame marble -window -nothrottle -skip_gameinfo -seconds_to_run <N> \
--        -rompath roms \
--        -autoboot_script oracle/mame_dumper.lua
--
--   MARBLE_LOVE_TRACE_PATH   - output file (default stdout)
--   MARBLE_LOVE_SCENARIO     - scenario name for the header
--   MARBLE_LOVE_INPUT_JSON   - path to JSON file with scripted input
--
-- RAM addresses from static Ghidra analysis; see docs/static-overview.md:
--   0x400014  u8   frame counter mid, incremented on VBLANK
--   0x400016  u8   frame counter low
--   0x400390  u16  game state flag
--   0x4003AE  u16  cache AV-control register
--   0x4003E2  u8   flag scroll/AV update
--   0x4003F0  u8   coin pulse current
--   0x4003F2  u8   coin pulse last
--   0x4003F4  u8   coin counter
--   0x400440  u32  stack low-water mark, debug-only and excluded from hash
--   0x401F40  u16  vblank skip flag

local SCHEMA_VERSION = 2

-- ─── Config ──────────────────────────────────────────────────────────────

local function getenv(name, fallback)
    local v = os.getenv(name)
    if v == nil or v == "" then return fallback end
    return v
end

local TRACE_PATH    = getenv("MARBLE_LOVE_TRACE_PATH", "/tmp/marble_trace.jsonl")
local SCENARIO      = getenv("MARBLE_LOVE_SCENARIO", "unknown")
local INPUT_JSON    = getenv("MARBLE_LOVE_INPUT_JSON", "")
local MAX_FRAMES    = tonumber(getenv("MARBLE_LOVE_MAX_FRAMES", "600"))

-- List of workRam region indices to dump as hex.
-- Example: MARBLE_DUMP_REGIONS=0x100,0x300 dumps workRam[0x100..0x1FF]
-- and workRam[0x300..0x3FF]. Use only for focused debugging because it
-- increases trace size.
local DUMP_REGIONS = {}
do
    local s = getenv("MARBLE_DUMP_REGIONS", "")
    for tok in string.gmatch(s, "[^,]+") do
        local n = tonumber(tok:match("^%s*(.-)%s*$"))
        if n ~= nil and n >= 0 and n < 0x2000 then
            table.insert(DUMP_REGIONS, n)
        end
    end
end

-- ─── State ───────────────────────────────────────────────────────────────

local out = nil
local cpu = nil
local mem = nil
local ports = nil
local frame_count = 0
local input_schedule = {}      -- frame_str → { dx?, dy?, buttons? }
local active_buttons = 0       -- bitmask currently asserted
local active_dx = 0
local active_dy = 0

-- ─── Utility: CRC32 for work RAM hashes ──────────────────────────────────
-- Standard table implementation. Used to fingerprint work RAM in the trace so
-- the diff harness can detect any divergence in

local crc_table = nil
local function crc32_init()
    if crc_table ~= nil then return end
    crc_table = {}
    for i = 0, 255 do
        local c = i
        for _ = 1, 8 do
            if (c & 1) ~= 0 then
                c = (c >> 1) ~ 0xEDB88320
            else
                c = c >> 1
            end
        end
        crc_table[i] = c
    end
end

local function crc32_mem(addr, n)
    crc32_init()
    local c = 0xFFFFFFFF
    for i = 0, n - 1 do
        local b = mem:read_u8(addr + i)
        c = (c >> 8) ~ crc_table[(c ~ b) & 0xFF]
    end
    return (~c) & 0xFFFFFFFF
end

-- ─── Input schedule loader ───────────────────────────────────────────────
-- Format scenario JSON:
--   { "inputs": { "60": { "buttons": 4 }, "120": { "dx": 5, "dy": -3 }, ... } }
-- Minimal parser; MAME Lua has no JSON library by default.

local function parse_inputs_json(path)
    local fh = io.open(path, "r")
    if not fh then return {} end
    local s = fh:read("*a")
    fh:close()
    local schedule = {}
    -- Trova "inputs": { e poi balance le graffe per estrarre fino al chiusura
    local i_start = s:find('"inputs"%s*:%s*{')
    if not i_start then return {} end
    -- Advance to the opening `{` of the inputs section.
    local open_brace = s:find("{", i_start)
    if not open_brace then return {} end
    -- balance braces
    local depth, j = 1, open_brace + 1
    while j <= #s and depth > 0 do
        local c = s:sub(j, j)
        if c == "{" then depth = depth + 1
        elseif c == "}" then depth = depth - 1 end
        j = j + 1
    end
    if depth ~= 0 then return {} end
    local body = s:sub(open_brace, j - 1)  -- include both braces
    -- Per ogni "frame_num": { ... }
    -- Lua patterns do not support nested {}: use an iterative scan.
    local p = 1
    local count = 0
    while true do
        local k_a, k_b, fr_str = body:find('"(%d+)"%s*:%s*{', p)
        if not k_a then break end
        local d, k = 1, k_b + 1
        while k <= #body and d > 0 do
            local c = body:sub(k, k)
            if c == "{" then d = d + 1
            elseif c == "}" then d = d - 1 end
            k = k + 1
        end
        local obj_body = body:sub(k_b, k - 1)
        local entry = {}
        for kk, vv in obj_body:gmatch('"([%w_]+)"%s*:%s*(-?%d+)') do
            entry[kk] = tonumber(vv)
        end
        schedule[tonumber(fr_str)] = entry
        count = count + 1
        p = k
    end
    return schedule, count
end

-- ─── Input application ───────────────────────────────────────────────────
-- Marble usa trackball (IN0/IN1 P1, IN2/IN3 P2) + button COIN/START.

local function apply_input_at_frame(frame)
    local entry = input_schedule[frame]
    if entry then
        if entry.dx ~= nil then active_dx = entry.dx end
        if entry.dy ~= nil then active_dy = entry.dy end
        if entry.buttons ~= nil then active_buttons = entry.buttons end
    end
    -- Apply currently active state every frame
    if ports[":IN0"] and ports[":IN0"].fields["Trackball X"] then
        ports[":IN0"].fields["Trackball X"]:set_value(active_dx & 0xFF)
    end
    if ports[":IN1"] and ports[":IN1"].fields["Trackball Y"] then
        ports[":IN1"].fields["Trackball Y"]:set_value(active_dy & 0xFF)
    end
    -- Buttons: bit0=START1, bit1=START2, bit2=COIN1
    local p = ports[":F60000"]
    if p then
        if p.fields["1 Player Start"] then
            p.fields["1 Player Start"]:set_value((active_buttons & 0x1) ~= 0 and 0 or 1)
        end
        if p.fields["2 Players Start"] then
            p.fields["2 Players Start"]:set_value((active_buttons & 0x2) ~= 0 and 0 or 1)
        end
    end
    local p2 = ports[":1820"]
    if p2 and p2.fields["Coin 1"] then
        p2.fields["Coin 1"]:set_value((active_buttons & 0x4) ~= 0 and 0 or 1)
    end
end

-- ─── State read ──────────────────────────────────────────────────────────

local function read_state()
    return {
        cpu_pc      = cpu.state["PC"].value,
        frame_mid   = mem:read_u8(0x400014),
        frame_low   = mem:read_u8(0x400016),
        rng_seed    = mem:read_u32(0x400000),  -- placeholder per ora
        obj_count   = mem:read_u16(0x400396),
        av_control  = mem:read_u16(0x4003AE),
        coin_ctr    = mem:read_u8(0x4003F4),
        vblank_skip = mem:read_u16(0x401F40),
        marble_x    = mem:read_u32(0x400018 + 0x00),
        marble_y    = mem:read_u32(0x400018 + 0x04),
        marble_z    = mem:read_u32(0x400018 + 0x08),
        marble_vx   = mem:read_u32(0x400018 + 0x0C),
        marble_vy   = mem:read_u32(0x400018 + 0x10),
        marble_vz   = mem:read_u32(0x400018 + 0x14),
        marble_type = mem:read_u8(0x400018 + 0x19),
        marble_anim = mem:read_u8(0x400018 + 0x70),
        marble_st   = mem:read_u8(0x400018 + 0xD8),
        -- Hash dell'intera Work RAM 8 KB. Esclude zone stack 68k:
        --   0x440-0x447   (stack low water debug)
        --   0x1EE0-0x1EFF (stack low water + sentinel bsr)
        work_ram_hash = crc32_mem(0x400000, 0x440)
                      ~ crc32_mem(0x400448, 0x1D40 - 0x448)
                      ~ crc32_mem(0x401E80, 0x1EE0 - 0x1E80)
                      ~ crc32_mem(0x401F00, 0x2000 - 0x1F00),
        -- Hash by region (32 regions of 0x100 bytes). See work_ram_regional_hashes.
        work_ram_hashes = work_ram_regional_hashes(),
    }
end

-- Esclusioni (stack-residue 68K):
--   Region 4 (0x400-0x4FF): esclude 0x440-0x447 (8 byte stack water)
--   Region 29 (0x1D00-0x1DFF): esclude 0x1D40-0x1DFF (192 byte stack scratch)
--   Region 30 (0x1E00-0x1EFF): esclude 0x1E00-0x1E7F + 0x1EE0-0x1EFF
function work_ram_regional_hashes()
    local h = {}
    for i = 0, 31 do
        local start = 0x400000 + i * 0x100
        if i == 4 then
            h[i + 1] = crc32_mem(0x400400, 0x40)
                     ~ crc32_mem(0x400448, 0x100 - 0x48)
        elseif i == 29 then
            -- 0x1D00-0x1DFF esclude 0x1D40-0x1DFF (192 byte stack scratch)
            h[i + 1] = crc32_mem(0x401D00, 0x40)
        elseif i == 30 then
            -- 0x1E00-0x1EFF esclude 0x1E00-0x1E7F + 0x1EE0-0x1EFF
            h[i + 1] = crc32_mem(0x401E80, 0x60)
        else
            h[i + 1] = crc32_mem(start, 0x100)
        end
    end
    return h
end

-- ─── JSONL writer ────────────────────────────────────────────────────────

local function jstr(s)
    return '"' .. tostring(s):gsub('\\', '\\\\'):gsub('"', '\\"') .. '"'
end

local function write_header()
    local h = string.format(
        '{"schemaVersion":%d,"source":"mame","scenario":%s,"startedAt":%s,"romCrc32":""}\n',
        SCHEMA_VERSION,
        jstr(SCENARIO),
        jstr(os.date("!%Y-%m-%dT%H:%M:%SZ"))
    )
    out:write(h)
    out:flush()
end

-- Hex-encode one workRam region: 256 bytes -> 512 hex chars.
local function dump_region_hex(off)
    local parts = {}
    for i = 0, 0xFF do
        parts[i + 1] = string.format("%02x", mem:read_u8(0x400000 + off + i))
    end
    return table.concat(parts)
end

local function write_frame(s)
    local parts = {}
    for i = 1, 32 do
        parts[i] = tostring(s.work_ram_hashes[i])
    end
    local hashes_json = "[" .. table.concat(parts, ",") .. "]"

    local dumps_json = ""
    if #DUMP_REGIONS > 0 then
        local entries = {}
        for _, off in ipairs(DUMP_REGIONS) do
            local hex = dump_region_hex(off)
            local key = string.format('"0x%03x"', off)
            table.insert(entries, key .. ':"' .. hex .. '"')
        end
        dumps_json = ',"workRamDumps":{' .. table.concat(entries, ",") .. '}'
    end

    out:write(string.format(
        '{"f":%d,"cpuTicks":%d,' ..
        '"rng":{"seed":%d,"calls":0},' ..
        '"marble":{"x":%d,"y":%d,"z":%d,"vx":%d,"vy":%d,"vz":%d,' ..
        '"alive":%d,"spriteIndex":%d},' ..
        '"stats":{"score":%d,"lives":%d,"timer":%d,"bonus":%d},' ..
        '"input":{"dx":%d,"dy":%d,"buttons":%d},' ..
        '"workRamHash":%d,"workRamHashes":%s%s}\n',
        frame_count, s.cpu_pc,
        s.rng_seed,
        s.marble_x, s.marble_y, s.marble_z, s.marble_vx, s.marble_vy, s.marble_vz,
        (s.marble_st & 1), s.marble_type,
        s.obj_count, s.coin_ctr, s.frame_mid, s.frame_low,
        active_dx & 0xFF, active_dy & 0xFF, active_buttons,
        s.work_ram_hash, hashes_json, dumps_json
    ))
end

-- ─── Setup ───────────────────────────────────────────────────────────────

emu.register_frame_done(function()
    if cpu == nil then
        -- Lazy init al primo frame
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
        ports = manager.machine.ioport.ports
        out = assert(io.open(TRACE_PATH, "w"))
        write_header()
        if INPUT_JSON ~= "" then
            local sched, count = parse_inputs_json(INPUT_JSON)
            input_schedule = sched
            print(string.format(
                "[marble-love] loaded %d input events from %s",
                count or 0, INPUT_JSON
            ))
        end
        print(string.format(
            "[marble-love] dumper started, scenario=%s, max_frames=%d, out=%s",
            SCENARIO, MAX_FRAMES, TRACE_PATH
        ))
    end

    apply_input_at_frame(frame_count)

    local ok, s = pcall(read_state)
    if ok then
        write_frame(s)
        if frame_count % 60 == 0 then out:flush() end
    else
        io.stderr:write(string.format(
            "[marble-love] read_state error at frame %d: %s\n",
            frame_count, tostring(s)
        ))
    end

    frame_count = frame_count + 1

    if frame_count >= MAX_FRAMES then
        out:flush()
        out:close()
        print(string.format(
            "[marble-love] reached %d frames, exiting", frame_count
        ))
        manager.machine:exit()
    end
end)
