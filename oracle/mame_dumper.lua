-- mame_dumper.lua — dumpa lo stato di Atari System 1 / Marble Madness frame-by-frame
-- Uso (lanciato dal wrapper run_oracle.ts):
--   mame marble -window -nothrottle -seconds_to_run <N> \
--        -autoboot_script oracle/mame_dumper.lua \
--        -autoboot_command "" -autoboot_delay 0
--
-- Output: scrive su stdout una riga JSON per frame (JSONL). Schema deve
-- restare in sync con `packages/engine/src/trace.ts` (TRACE_SCHEMA_VERSION).
--
-- Variabili d'ambiente lette:
--   MARBLE_LOVE_TRACE_PATH   — file di output (default stdout)
--   MARBLE_LOVE_SCENARIO     — nome scenario (per header)
--   MARBLE_LOVE_INPUT_JSON   — path al file inputs.json (per scripted input)
--   MARBLE_LOVE_MAX_FRAMES   — stop dopo N frame
--
-- TODO Phase 3:
--   - Identificare in atarisys1.cpp gli indirizzi RAM esatti del game state
--     (marble pos/vel, score, lives, RNG seed).
--   - Riempire `read_state()` con quegli indirizzi.
--   - Implementare iniezione input scripted da MARBLE_LOVE_INPUT_JSON.
--   - Hash work-RAM con xxhash o crc32 (vedi MAME emu.utils).
--
-- Riferimento schema (versione 1):
--   { "f":N, "cpuTicks":N, "rng":{"seed":N,"calls":N},
--     "marble":{"x":N,"y":N,"z":N,"vx":N,"vy":N,"vz":N,"alive":0|1,"spriteIndex":N},
--     "stats":{"score":N,"lives":N,"timer":N,"bonus":N},
--     "input":{"dx":N,"dy":N,"buttons":N},
--     "workRamHash":"hex" }

local SCHEMA_VERSION = 1

-- ─── Util ────────────────────────────────────────────────────────────────

local function getenv(name, fallback)
    local v = os.getenv(name)
    if v == nil or v == "" then return fallback end
    return v
end

local function open_output()
    local path = getenv("MARBLE_LOVE_TRACE_PATH", nil)
    if path == nil then return io.stdout end
    return assert(io.open(path, "w"))
end

local function json_escape(s)
    return s:gsub('\\', '\\\\'):gsub('"', '\\"')
end

-- Encoder JSON minimale per i nostri record (no float, no nested arrays
-- complessi → bastano hand-written serializer più veloci di un parser).
local function j_str(s) return '"' .. json_escape(tostring(s)) .. '"' end
local function j_kv(k, v) return j_str(k) .. ':' .. tostring(v) end
local function j_kvs(k, v) return j_str(k) .. ':' .. j_str(v) end

-- ─── State ───────────────────────────────────────────────────────────────

local out = open_output()
local scenario = getenv("MARBLE_LOVE_SCENARIO", "unknown")
local max_frames = tonumber(getenv("MARBLE_LOVE_MAX_FRAMES", "0"))

local cpu, mem, screen
local frame_count = 0

-- Indirizzi placeholder. Phase 3 li sostituisce con i veri (da atarisys1.cpp
-- + analisi Ghidra del binario).
local ADDR_RNG_SEED      = 0x800000  -- placeholder
local ADDR_MARBLE_X      = 0x800010
local ADDR_MARBLE_Y      = 0x800014
local ADDR_MARBLE_Z      = 0x800018
local ADDR_MARBLE_VX     = 0x80001C
local ADDR_MARBLE_VY     = 0x800020
local ADDR_MARBLE_VZ     = 0x800024
local ADDR_MARBLE_FLAGS  = 0x800028
local ADDR_SCORE         = 0x800040  -- BCD packed?
local ADDR_LIVES         = 0x800048
local ADDR_TIMER         = 0x80004A
local ADDR_BONUS         = 0x80004C

local function read_u8(addr)  return mem:read_u8(addr)  end
local function read_u16(addr) return mem:read_u16(addr) end
local function read_u32(addr) return mem:read_u32(addr) end

local function read_state()
    return {
        cpuTicks = cpu.state["PC"].value,  -- Phase 3: usare cpu.cycles or similar
        rng_seed = read_u32(ADDR_RNG_SEED),
        marble = {
            x = read_u32(ADDR_MARBLE_X),
            y = read_u32(ADDR_MARBLE_Y),
            z = read_u32(ADDR_MARBLE_Z),
            vx = read_u32(ADDR_MARBLE_VX),
            vy = read_u32(ADDR_MARBLE_VY),
            vz = read_u32(ADDR_MARBLE_VZ),
            flags = read_u8(ADDR_MARBLE_FLAGS),
        },
        stats = {
            score = read_u32(ADDR_SCORE),
            lives = read_u8(ADDR_LIVES),
            timer = read_u16(ADDR_TIMER),
            bonus = read_u16(ADDR_BONUS),
        },
        input = { dx = 0, dy = 0, buttons = 0 },  -- Phase 3: leggere MMIO trackball
    }
end

local function write_header()
    out:write('{')
    out:write(j_kv("schemaVersion", SCHEMA_VERSION))
    out:write(',')
    out:write(j_kvs("source", "mame"))
    out:write(',')
    out:write(j_kvs("scenario", scenario))
    out:write(',')
    out:write(j_kvs("startedAt", os.date("!%Y-%m-%dT%H:%M:%SZ")))
    out:write('}\n')
    out:flush()
end

local function write_frame(s)
    out:write('{')
    out:write(j_kv("f", frame_count)); out:write(',')
    out:write(j_kv("cpuTicks", s.cpuTicks)); out:write(',')
    out:write(j_str("rng")); out:write(':{')
    out:write(j_kv("seed", s.rng_seed)); out:write(',')
    out:write(j_kv("calls", 0)); out:write('},')
    out:write(j_str("marble")); out:write(':{')
    out:write(j_kv("x", s.marble.x)); out:write(',')
    out:write(j_kv("y", s.marble.y)); out:write(',')
    out:write(j_kv("z", s.marble.z)); out:write(',')
    out:write(j_kv("vx", s.marble.vx)); out:write(',')
    out:write(j_kv("vy", s.marble.vy)); out:write(',')
    out:write(j_kv("vz", s.marble.vz)); out:write(',')
    out:write(j_kv("alive", (s.marble.flags & 1))); out:write(',')
    out:write(j_kv("spriteIndex", 0)); out:write('},')
    out:write(j_str("stats")); out:write(':{')
    out:write(j_kv("score", s.stats.score)); out:write(',')
    out:write(j_kv("lives", s.stats.lives)); out:write(',')
    out:write(j_kv("timer", s.stats.timer)); out:write(',')
    out:write(j_kv("bonus", s.stats.bonus)); out:write('},')
    out:write(j_str("input")); out:write(':{')
    out:write(j_kv("dx", s.input.dx)); out:write(',')
    out:write(j_kv("dy", s.input.dy)); out:write(',')
    out:write(j_kv("buttons", s.input.buttons)); out:write('}')
    out:write('}\n')
end

-- ─── Setup ───────────────────────────────────────────────────────────────

emu.register_start(function()
    cpu = manager.machine.devices[":maincpu"]
    mem = cpu.spaces["program"]
    screen = manager.machine.screens[":screen"]
    write_header()
    print("[marble-love] dumper started, scenario=" .. scenario)
end)

emu.register_frame_done(function()
    frame_count = frame_count + 1
    local ok, s = pcall(read_state)
    if ok then
        write_frame(s)
        if frame_count % 60 == 0 then out:flush() end
    else
        io.stderr:write("[marble-love] read_state error at frame " .. frame_count .. "\n")
    end
    if max_frames > 0 and frame_count >= max_frames then
        out:flush()
        if out ~= io.stdout then out:close() end
        manager.machine:exit()
    end
end)

emu.register_stop(function()
    out:flush()
    if out ~= io.stdout then out:close() end
end)
