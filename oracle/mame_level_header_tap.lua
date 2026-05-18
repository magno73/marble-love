-- mame_level_header_tap.lua — installa read taps su tutti i campi noti del
-- level descriptor header per i 6 livelli.
--
-- Scope: PRD `docs/level-header-decode-prd.md` Phase 1 deliverable (script
-- ready-to-run). Verifica empirica che i field decoded TS coincidano con i
-- valori realmente letti dal 68010 sul binario originale.
--
-- Lancio (path locale ROMS, MAME 0.286+):
--   mame marble -nothrottle -nowindow -seconds_to_run 600 \
--     -plugin marble_level_header \
--     -plugin_path oracle/ \
--     -autoboot_script oracle/mame_level_header_tap.lua
--
-- Override target levels via env:
--   MARBLE_LEVEL_TAP_INDICES="0,1,2,3,4,5"  (default: all)
--   MARBLE_LEVEL_TAP_OUTPUT="/tmp/level_header_taps.log"  (default stdout)
--
-- Output formato per ogni read:
--   FRAME=N PC=0xPPPPPP OFFSET=0xOOOO LEVEL=L FIELD=name VALUE=0xVVVV SIZE=word|long
--
-- NB: questo script richiede MAME, le ROM (`marble.zip` + `atarisy1.zip`)
-- e un blob ROM disassemblabile. NON puo' essere lanciato in container
-- senza tooling.

local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]

-- Pointer table ROM (verificata Phase 4b)
local LEVEL_ROM_BASES = {
  [0] = 0x2BEE2, -- Practice
  [1] = 0x2C54C, -- Beginner
  [2] = 0x2CD9E, -- Intermediate
  [3] = 0x2D648, -- Aerial
  [4] = 0x2DE1E, -- Silly
  [5] = 0x2E790, -- Ultimate
}

local LEVEL_NAMES = {
  [0] = "Practice",
  [1] = "Beginner",
  [2] = "Intermediate",
  [3] = "Aerial",
  [4] = "Silly",
  [5] = "Ultimate",
}

-- Campi noti del header. Format: {offset, size_bytes, field_name}
local KNOWN_FIELDS = {
  { 0x00, 4, "directTerrainPtr" },
  { 0x04, 4, "tileWordTablePtr" },
  { 0x08, 4, "UNKNOWN_08" },
  { 0x0C, 4, "rleSourcePtr" },
  { 0x10, 2, "yScrollBase" },
  { 0x12, 2, "yScrollRange" },
  { 0x14, 2, "entityInitPos_0" },
  { 0x16, 2, "entityInitPos_1" },
  { 0x18, 2, "maxTileBound_OR_entityInitPos_2" },
  { 0x1A, 2, "entityInitPos_3_orUnknown" },
  { 0x1C, 2, "entityInitPos_4_orUnknown" },
  { 0x1E, 2, "entityInitPos_5_orUnknown" },
  { 0x20, 4, "subPatternTablePtr" },
  { 0x24, 2, "UNKNOWN_24" },
  { 0x26, 4, "binsearchBasePtr" },
  { 0x2A, 4, "extByteTablePtr" },
}

-- Resolve target level indices from env, default all
local function parse_indices()
  local raw = os.getenv("MARBLE_LEVEL_TAP_INDICES")
  if raw == nil or raw == "" then
    return { 0, 1, 2, 3, 4, 5 }
  end
  local out = {}
  for token in string.gmatch(raw, "([^,]+)") do
    local n = tonumber(token)
    if n ~= nil and n >= 0 and n <= 5 then
      table.insert(out, n)
    end
  end
  return out
end

local target_levels = parse_indices()

-- Open output file (default stdout)
local out_file = nil
local output_path = os.getenv("MARBLE_LEVEL_TAP_OUTPUT")
if output_path ~= nil and output_path ~= "" then
  out_file = io.open(output_path, "w")
  if out_file == nil then
    print(string.format("[level-header-tap] WARN: cannot open %s, falling back to stdout", output_path))
  end
end

local function log(line)
  if out_file ~= nil then
    out_file:write(line)
    out_file:write("\n")
  else
    print(line)
  end
end

-- Install read taps per (level_index, field)
local installed_taps = {}

for _, level_index in ipairs(target_levels) do
  local base = LEVEL_ROM_BASES[level_index]
  if base ~= nil then
    for _, field in ipairs(KNOWN_FIELDS) do
      local offset = field[1]
      local size = field[2]
      local name = field[3]
      local addr_lo = base + offset
      local addr_hi = base + offset + size - 1

      local tap_name = string.format("level%d_%s", level_index, name)
      local handle = space:install_read_tap(
        addr_lo, addr_hi, tap_name,
        function(taddr, data, mask)
          local pc = cpu.state["PC"].value
          local frame = manager.machine.screens[":screen"]:frame_number()
          local size_str = (size == 4) and "long" or "word"
          log(string.format(
            "FRAME=%d PC=0x%06x OFFSET=0x%04x LEVEL=%d FIELD=%s VALUE=0x%x SIZE=%s",
            frame, pc, addr_lo - base, level_index, name, data, size_str
          ))
        end
      )
      table.insert(installed_taps, handle)
    end
  end
end

log(string.format("[level-header-tap] Installed %d read taps across %d levels", #installed_taps, #target_levels))
log(string.format("[level-header-tap] Watching levels: %s", table.concat(target_levels, ",")))
log("[level-header-tap] Run until exit; capture file: " .. (output_path or "stdout"))

-- Periodic flush
local last_flush_frame = 0
emu.register_frame_done(function()
  if out_file ~= nil then
    local frame = manager.machine.screens[":screen"]:frame_number()
    if frame - last_flush_frame >= 600 then
      out_file:flush()
      last_flush_frame = frame
    end
  end
end)

-- Close on stop
emu.register_stop(function()
  if out_file ~= nil then
    out_file:flush()
    out_file:close()
  end
end)

-- Expected usage flow:
--
-- 1. Boot MAME with this tap. Levels 0-5 read taps are installed at ROM
--    boot time (before any level transition).
-- 2. Use `oracle/mame_playable_input_capture.lua` workflow to drive MAME
--    through coin/start sequences that load each level (vedi
--    `docs/archive/readme-status-2026-05-18/README.full.md:166-176` per
--    `MARBLE_PLAYABLE_BOOTSTRAP_TARGET_LEVEL=1..6`).
-- 3. Capture the log file. Expected pattern: each field of each loaded
--    level produces one or more FRAME=... entries from PC=0x16EC6 (level
--    dispatcher), 0x16F6C (level init), 0x259B4 (object init), etc.
-- 4. Compare against the static decode produced by
--    `packages/cli/src/probe-level-header.ts`. Discrepancies (PC reads a
--    field at an offset not documented, or no read observed for a field
--    we documented) drive Phase 2 / 3 of the PRD.
