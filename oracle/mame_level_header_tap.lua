-- mame_level_header_tap.lua - install read taps on all known level descriptor
-- header fields for the six levels.
--
-- Scope: level header decoding evidence for `docs/level-header-format.md` (script
-- ready-to-run). Empirically verify that TS decoded fields match the
-- values actually read by the 68010 on the original binary.
--
-- Launch (local ROM path, MAME 0.286+):
--   mame marble -nothrottle -nowindow -seconds_to_run 600 \
--     -plugin marble_level_header \
--     -plugin_path oracle/ \
--     -autoboot_script oracle/mame_level_header_tap.lua
--
-- Override target levels via env:
--   MARBLE_LEVEL_TAP_INDICES="0,1,2,3,4,5"  (default: all)
--   MARBLE_LEVEL_TAP_OUTPUT="/tmp/level_header_taps.log"  (default stdout)
--   MARBLE_LEVEL_TAP_PLAYABLE_CAPTURE=1 composes with
--     oracle/mame_playable_input_capture.lua for bootstrap
--     MARBLE_PLAYABLE_BOOTSTRAP_TARGET_LEVEL=1..6.
--   MARBLE_LEVEL_TAP_RAW_ADDRESS_TAPS=1 also enables raw address taps
--     original values. Default off: MAME can invoke those taps on accesses
--     partial, so values are not suitable for field-level comparison.
--   MARBLE_LEVEL_TAP_FORCE_ENTITY_INIT_COUNT=N forces diagnostic RAM
--     objCount=N and obj[i]+0x18=3 during bootstrap. It only serves to
--     esercitare il consumer ROM `FUN_259B4` sugli slot entity-init.
--
-- Output format for each read:
--   FRAME=N PC=0xPPPPPP OFFSET=0xOOOO LEVEL=L FIELD=name VALUE=0xVVVV SIZE=word|long
--
-- Note: this script requires MAME plus ROMs (`marble.zip` and `atarisy1.zip`).
-- and a disassemblable ROM blob. It cannot run in container without tooling.

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
  { 0x08, 4, "rowBuildBitListPtr" },
  { 0x0C, 4, "rleSourcePtr" },
  { 0x10, 2, "yScrollBase" },
  { 0x12, 2, "yScrollRange" },
  { 0x14, 2, "entityInitPos_0" },
  { 0x16, 2, "entityInitPos_1" },
  { 0x18, 2, "maxTileBound_OR_entityInitPos_2" },
  { 0x1A, 2, "rowBuildEntryCount_OR_entityInitPos_3" },
  { 0x1C, 2, "tileLineDescriptorPtr_hi_OR_entityInitPos_4" },
  { 0x1E, 2, "tileLineDescriptorPtr_lo_OR_entityInitPos_5" },
  { 0x20, 4, "subPatternTablePtr" },
  { 0x24, 2, "binsearchEndIndex" },
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
local RAW_ADDRESS_TAPS = os.getenv("MARBLE_LEVEL_TAP_RAW_ADDRESS_TAPS") == "1"
local FORCE_ENTITY_INIT_COUNT = tonumber(os.getenv("MARBLE_LEVEL_TAP_FORCE_ENTITY_INIT_COUNT") or "")
if FORCE_ENTITY_INIT_COUNT ~= nil then
  FORCE_ENTITY_INIT_COUNT = math.floor(FORCE_ENTITY_INIT_COUNT)
  if FORCE_ENTITY_INIT_COUNT < 1 then FORCE_ENTITY_INIT_COUNT = 1 end
  if FORCE_ENTITY_INIT_COUNT > 6 then FORCE_ENTITY_INIT_COUNT = 6 end
end

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

-- Install read taps for (level_index, field).
local installed_taps = {}
local pc_tap_last_key = nil

local target_level_set = {}
for _, level_index in ipairs(target_levels) do
  target_level_set[level_index] = true
end

local LEVEL_INDEX_BY_BASE = {}
for level_index, base in pairs(LEVEL_ROM_BASES) do
  LEVEL_INDEX_BY_BASE[base] = level_index
end

local function read_u16(addr)
  return space:read_u16(addr) & 0xffff
end

local function read_u32(addr)
  return space:read_u32(addr) & 0xffffffff
end

local function write_u8(addr, value)
  space:write_u8(addr, value & 0xff)
end

local function write_u16(addr, value)
  space:write_u16(addr, value & 0xffff)
end

local function current_level_base()
  local ok, ptr = pcall(function() return read_u32(0x400474) end)
  if not ok then return nil end
  if LEVEL_INDEX_BY_BASE[ptr] == nil then return nil end
  return ptr
end

local function field_value(base, offset, size)
  if size == 4 then
    return read_u32(base + offset)
  end
  return read_u16(base + offset)
end

local function install_pc_field_tap(pc, field)
  local handle = space:install_read_tap(
    pc, pc + 1, string.format("level_header_pc_%06x_%s", pc, field.name),
    function(_taddr, data, _mask)
      local base = current_level_base()
      if base == nil then return data end
      local level_index = LEVEL_INDEX_BY_BASE[base]
      if not target_level_set[level_index] then return data end

      local offset = field.offset
      local name = field.name
      if field.dynamic_entity then
        local entity_index = cpu.state["D2"].value & 0xffff
        if entity_index > 5 then return data end
        offset = 0x14 + entity_index * 2
        name = string.format("entityInitPos_%d", entity_index)
        if entity_index == 2 then
          name = "entityInitPos_2_OR_maxTileBound"
        end
      end

      local frame = manager.machine.screens[":screen"]:frame_number()
      local sp = cpu.state["SP"].value
      local key = string.format("%d:%06x:%08x:%04x:%d", frame, pc, sp, offset, level_index)
      if key == pc_tap_last_key then return data end
      pc_tap_last_key = key

      local size = field.size
      local value = field_value(base, offset, size)
      local size_str = (size == 4) and "long" or "word"
      log(string.format(
        "FRAME=%d PC=0x%06x OFFSET=0x%04x LEVEL=%d FIELD=%s VALUE=0x%x SIZE=%s SOURCE=pc-tap",
        frame, pc, offset, level_index, name, value, size_str
      ))
      return data
    end
  )
  table.insert(installed_taps, handle)
end

local PC_FIELD_TAPS = {
  { pc = 0x01a45a, offset = 0x1a, size = 2, name = "rowBuildEntryCount" },
  { pc = 0x01a462, offset = 0x08, size = 4, name = "rowBuildBitListPtr" },
  { pc = 0x01a470, offset = 0x24, size = 2, name = "binsearchEndIndex" },
  { pc = 0x01a4aa, offset = 0x18, size = 2, name = "maxTileBound" },
  { pc = 0x01a4d0, offset = 0x1c, size = 4, name = "tileLineDescriptorPtr" },
  { pc = 0x016f34, offset = 0x26, size = 4, name = "binsearchBasePtr" },
  { pc = 0x016f44, offset = 0x10, size = 2, name = "yScrollBase" },
  { pc = 0x016f5a, offset = 0x12, size = 2, name = "yScrollRange" },
  { pc = 0x016f98, offset = 0x04, size = 4, name = "tileWordTablePtr" },
  { pc = 0x016f9e, offset = 0x2a, size = 4, name = "extByteTablePtr" },
  { pc = 0x016fb8, offset = 0x12, size = 2, name = "yScrollRange" },
  { pc = 0x018fd8, offset = 0x0c, size = 4, name = "rleSourcePtr" },
  { pc = 0x0259f2, offset = 0x14, size = 2, name = "entityInitPos", dynamic_entity = true },
  { pc = 0x017806, offset = 0x18, size = 2, name = "maxTileBound" },
  { pc = 0x01aa4a, offset = 0x00, size = 4, name = "directTerrainPtr" },
  { pc = 0x01cb0e, offset = 0x18, size = 2, name = "maxTileBound" },
  { pc = 0x01cb7a, offset = 0x00, size = 4, name = "directTerrainPtr" },
  { pc = 0x01ae44, offset = 0x20, size = 4, name = "subPatternTablePtr" },
}

local pc_taps_installed = false
local force_entity_last_key = nil

local function force_entity_init_slots()
  if FORCE_ENTITY_INIT_COUNT == nil then return end
  write_u16(0x400396, FORCE_ENTITY_INIT_COUNT)
  for i = 0, FORCE_ENTITY_INIT_COUNT - 1 do
    write_u8(0x400018 + i * 0xe2 + 0x18, 3)
  end
end

local function install_force_entity_init_tap()
  if FORCE_ENTITY_INIT_COUNT == nil then return end
  local entry_handle = space:install_read_tap(
    0x0259b4, 0x0259b5, "level_header_force_entity_init_259b4",
    function(_taddr, data, _mask)
      local base = current_level_base()
      if base == nil then return data end
      local level_index = LEVEL_INDEX_BY_BASE[base]
      if not target_level_set[level_index] then return data end
      force_entity_init_slots()
      local frame = manager.machine.screens[":screen"]:frame_number()
      local key = string.format("%d:%d", frame, level_index)
      if key ~= force_entity_last_key then
        force_entity_last_key = key
        log(string.format(
          "[level-header-tap] Forced diagnostic entity init count=%d at FUN_259B4 frame=%d level=%d",
          FORCE_ENTITY_INIT_COUNT,
          frame,
          level_index
        ))
      end
      return data
    end
  )
  table.insert(installed_taps, entry_handle)

  local loop_handle = space:install_read_tap(
    0x0259c4, 0x0259c5, "level_header_force_entity_iter_259c4",
    function(_taddr, data, _mask)
      local base = current_level_base()
      if base == nil then return data end
      local level_index = LEVEL_INDEX_BY_BASE[base]
      if not target_level_set[level_index] then return data end
      local entity_index = cpu.state["D2"].value & 0xffff
      if entity_index >= FORCE_ENTITY_INIT_COUNT then return data end
      write_u16(0x400396, FORCE_ENTITY_INIT_COUNT)
      write_u8(cpu.state["A2"].value + 0x18, 3)
      return data
    end
  )
  table.insert(installed_taps, loop_handle)

  local cmp_handle = space:install_read_tap(
    0x025b30, 0x025b31, "level_header_force_entity_cmp_25b30",
    function(_taddr, data, _mask)
      local base = current_level_base()
      if base == nil then return data end
      local level_index = LEVEL_INDEX_BY_BASE[base]
      if not target_level_set[level_index] then return data end
      write_u16(0x400396, FORCE_ENTITY_INIT_COUNT)
      return data
    end
  )
  table.insert(installed_taps, cmp_handle)
end

if RAW_ADDRESS_TAPS then
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
          function(_taddr, data, _mask)
            local pc = cpu.state["PC"].value
            local frame = manager.machine.screens[":screen"]:frame_number()
            local size_str = (size == 4) and "long" or "word"
            log(string.format(
              "FRAME=%d PC=0x%06x OFFSET=0x%04x LEVEL=%d FIELD=%s VALUE=0x%x SIZE=%s SOURCE=addr-tap",
              frame, pc, addr_lo - base, level_index, name, data, size_str
            ))
          end
        )
        table.insert(installed_taps, handle)
      end
    end
  end
end

log(string.format("[level-header-tap] Installed %d raw address taps across %d levels", #installed_taps, #target_levels))
log(string.format("[level-header-tap] Watching levels: %s", table.concat(target_levels, ",")))
log("[level-header-tap] Run until exit; capture file: " .. (output_path or "stdout"))

-- Periodic flush
local last_flush_frame = 0
emu.register_frame_done(function()
  if not pc_taps_installed then
    for _, field in ipairs(PC_FIELD_TAPS) do
      install_pc_field_tap(field.pc, field)
    end
    install_force_entity_init_tap()
    pc_taps_installed = true
    log(string.format("[level-header-tap] Installed %d consumer PC taps", #PC_FIELD_TAPS))
  end
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

if os.getenv("MARBLE_LEVEL_TAP_PLAYABLE_CAPTURE") == "1" then
  dofile("oracle/mame_playable_input_capture.lua")
end

-- Expected usage flow:
--
-- 1. Boot MAME with this tap. Levels 0-5 read taps are installed at ROM
--    boot time (before any level transition).
-- 2. Use `oracle/mame_playable_input_capture.lua` workflow to drive MAME
--    through coin/start sequences that load each level. Use earlier route
--    notes when reconstructing the original candidate captures
--    (`MARBLE_PLAYABLE_BOOTSTRAP_TARGET_LEVEL=1..6`).
-- 3. Capture the log file. Expected pattern: each field of each loaded
--    level produces one or more FRAME=... entries from PC=0x16EC6 (level
--    dispatcher), 0x16F6C (level init), 0x259B4 (object init), etc.
-- 4. Compare against the static decode produced by
--    `packages/cli/src/probe-level-header.ts`. Discrepancies (PC reads a
--    field at an offset not documented, or no read observed for a field
--    we documented) drive Phase 2 / 3 of the PRD.
