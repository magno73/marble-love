-- mame_sound_cmd_inject_scan.lua — scan forced sound command bytes for POKEY use.
--
-- This is a diagnostic oracle script. It lets the normal Marble boot/release
-- sequence happen, then injects command bytes into the main->sound latch via
-- the main CPU address space and records whether any POKEY voice registers get
-- non-zero writes. It does not replace real gameplay captures; it answers the
-- narrower question "can any command byte make this driver use audible POKEY?"
--
-- Env:
--   MARBLE_INJECT_OUT          output JSON path
--   MARBLE_INJECT_START_FRAME  first injected frame (default 500)
--   MARBLE_INJECT_SPACING      frames between injected bytes (default 30)
--   MARBLE_INJECT_SETTLE       extra frames after last injection (default 120)

local OUT_PATH = os.getenv("MARBLE_INJECT_OUT") or "/tmp/mame_sound_cmd_inject_scan.json"
local START_FRAME = tonumber(os.getenv("MARBLE_INJECT_START_FRAME") or "500") or 500
local SPACING = tonumber(os.getenv("MARBLE_INJECT_SPACING") or "30") or 30
local SETTLE = tonumber(os.getenv("MARBLE_INJECT_SETTLE") or "120") or 120
if SPACING < 1 then SPACING = 1 end
SPACING = math.floor(SPACING)

local TARGET_FRAME = START_FRAME + (256 * SPACING) + SETTLE
local maincpu, main_mem
local audiocpu, sound_mem
local frame_count = 0
local installed = false
local tap_handles = {}
local injections = {}
local main_cmd_writes = {}
local pokey_writes = {}
local pokey_nonzero = {}
local pokey_audible = {}
local pokey_write_count = 0
local ym_writes = 0
local selected_ym_reg = 0
local last_injected_cmd = -1
local last_injected_frame = -1

local function hx(v, width)
    return string.format("0x%0" .. tostring(width) .. "x", v & ((1 << (width * 4)) - 1))
end

local function normalize_addr(base, offset)
    if offset < base then return base + offset end
    return offset
end

local function maybe_record_pokey(reg, data, pc)
    pokey_write_count = pokey_write_count + 1
    local entry = {
        frame = frame_count,
        reg = reg & 0x0f,
        data = data & 0xff,
        pc = pc,
        afterCmd = last_injected_cmd,
        framesAfterCmd = last_injected_frame < 0 and -1 or (frame_count - last_injected_frame),
    }
    if #pokey_writes < 20000 then
        table.insert(pokey_writes, entry)
    end
    if entry.data ~= 0 and entry.reg <= 7 then
        table.insert(pokey_nonzero, entry)
    end
    if (entry.reg == 1 or entry.reg == 3 or entry.reg == 5 or entry.reg == 7) and
        (entry.data & 0x0f) ~= 0 then
        table.insert(pokey_audible, entry)
    end
end

local function install_taps()
    maincpu = manager.machine.devices[":maincpu"]
    main_mem = maincpu.spaces["program"]
    for _, tag in ipairs({":audiocpu", ":soundcpu"}) do
        if manager.machine.devices[tag] then
            audiocpu = manager.machine.devices[tag]
            break
        end
    end
    sound_mem = audiocpu.spaces["program"]

    table.insert(tap_handles, main_mem:install_write_tap(0xFE0000, 0xFE0001, "inject_cmd_w", function(offset, data, mask)
        if (mask & 0xff) ~= 0 and #main_cmd_writes < 20000 then
            local pc = maincpu.state["PC"] and maincpu.state["PC"].value or -1
            table.insert(main_cmd_writes, {
                frame = frame_count,
                byte = data & 0xff,
                pc = pc,
                afterCmd = last_injected_cmd,
                framesAfterCmd = last_injected_frame < 0 and -1 or (frame_count - last_injected_frame),
            })
        end
        return data
    end))

    table.insert(tap_handles, sound_mem:install_write_tap(0x1000, 0x3fff, "inject_sound_w", function(offset, data, mask)
        local addr = normalize_addr(0x1000, offset)
        local ym_masked = addr & 0xD871
        if ym_masked == 0x1800 then
            selected_ym_reg = data & 0xff
        elseif ym_masked == 0x1801 then
            ym_writes = ym_writes + 1
        end

        local pokey_masked = addr & 0xD87F
        if (pokey_masked & 0xfff0) == 0x1870 then
            local pc = audiocpu.state["PC"] and audiocpu.state["PC"].value or -1
            maybe_record_pokey(addr & 0x0f, data & 0xff, pc)
        end
        return data
    end))

    installed = true
    print(string.format("[inject_scan] installed; start=%d spacing=%d target=%d", START_FRAME, SPACING, TARGET_FRAME))
end

local function inject_command(cmd)
    if main_mem.write_u8 ~= nil then
        main_mem:write_u8(0xFE0001, cmd & 0xff)
    else
        main_mem:write_u16(0xFE0000, cmd & 0xff)
    end
    last_injected_cmd = cmd & 0xff
    last_injected_frame = frame_count
    table.insert(injections, {
        frame = frame_count,
        byte = cmd & 0xff,
    })
end

local function write_json()
    local out = assert(io.open(OUT_PATH, "w"))
    out:write("{\n")
    out:write(string.format('  "frame": %d,\n', frame_count))
    out:write(string.format('  "startFrame": %d,\n', START_FRAME))
    out:write(string.format('  "spacing": %d,\n', SPACING))
    out:write(string.format('  "injectionCount": %d,\n', #injections))
    out:write(string.format('  "mainCmdWriteCount": %d,\n', #main_cmd_writes))
    out:write(string.format('  "ymWriteCount": %d,\n', ym_writes))
    out:write(string.format('  "pokeyWriteCount": %d,\n', pokey_write_count))
    out:write(string.format('  "pokeyWriteSampleCount": %d,\n', #pokey_writes))
    out:write(string.format('  "pokeyNonzeroCount": %d,\n', #pokey_nonzero))
    out:write(string.format('  "pokeyAudibleWriteCount": %d,\n', #pokey_audible))

    out:write('  "injections": [\n')
    for i, e in ipairs(injections) do
        local sep = (i < #injections) and "," or ""
        out:write(string.format('    {"frame": %d, "byte": "%s"}%s\n', e.frame, hx(e.byte, 2), sep))
    end
    out:write("  ],\n")

    out:write('  "pokeyNonzero": [\n')
    for i, e in ipairs(pokey_nonzero) do
        local sep = (i < #pokey_nonzero) and "," or ""
        out:write(string.format(
            '    {"frame": %d, "reg": "%s", "data": "%s", "pc": "%s", "afterCmd": "%s", "framesAfterCmd": %d}%s\n',
            e.frame, hx(e.reg, 1), hx(e.data, 2), hx(e.pc, 4), hx(e.afterCmd, 2), e.framesAfterCmd, sep))
    end
    out:write("  ],\n")

    out:write('  "pokeyAudible": [\n')
    for i, e in ipairs(pokey_audible) do
        local sep = (i < #pokey_audible) and "," or ""
        out:write(string.format(
            '    {"frame": %d, "reg": "%s", "data": "%s", "pc": "%s", "afterCmd": "%s", "framesAfterCmd": %d}%s\n',
            e.frame, hx(e.reg, 1), hx(e.data, 2), hx(e.pc, 4), hx(e.afterCmd, 2), e.framesAfterCmd, sep))
    end
    out:write("  ],\n")

    out:write('  "pokeyWriteSamples": [\n')
    for i, e in ipairs(pokey_writes) do
        local sep = (i < #pokey_writes) and "," or ""
        out:write(string.format(
            '    {"frame": %d, "reg": "%s", "data": "%s", "pc": "%s", "afterCmd": "%s", "framesAfterCmd": %d}%s\n',
            e.frame, hx(e.reg, 1), hx(e.data, 2), hx(e.pc, 4), hx(e.afterCmd, 2), e.framesAfterCmd, sep))
    end
    out:write("  ]\n")
    out:write("}\n")
    out:close()
    print(string.format("[inject_scan] saved %d injections, %d POKEY writes, %d non-zero, %d audible to %s",
        #injections, pokey_write_count, #pokey_nonzero, #pokey_audible, OUT_PATH))
end

emu.register_frame_done(function()
    if not installed then install_taps() end
    frame_count = frame_count + 1

    local index = math.floor((frame_count - START_FRAME) / SPACING)
    if frame_count >= START_FRAME and index >= 0 and index < 256 and
        frame_count == START_FRAME + (index * SPACING) then
        inject_command(index)
    end

    if frame_count >= TARGET_FRAME then
        write_json()
        manager.machine:exit()
    end
end)
