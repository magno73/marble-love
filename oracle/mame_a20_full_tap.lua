-- mame_a20_full_tap.lua — focused write tap for object-pair slot 0x400A20.

local function getenv(name, fallback)
    local v = os.getenv(name)
    if v == nil or v == "" then return fallback end
    return v
end

local FROM_FR  = tonumber(getenv("MARBLE_TRACE_FROM", "14990"))
local TO_FR    = tonumber(getenv("MARBLE_TRACE_TO", "15012"))
local OUT_PATH = getenv("MARBLE_TRACE_OUT", "/tmp/mame_a20_full_tap.json")
local MAX      = tonumber(getenv("MARBLE_TRACE_MAX_SAMPLES", "40000"))
local BASE     = tonumber(getenv("MARBLE_TRACE_BASE", "0x400A20"))
local COMPOSE_PLAYABLE = getenv("MARBLE_TRACE_PLAYABLE_CAPTURE", "0") == "1"

local REGIONS = {
    { lo = BASE, hi = BASE + 0x1F, label = "head" },
    { lo = BASE + 0x66, hi = BASE + 0x7F, label = "tail" },
}

local cpu, mem, pc_state, sp_state
local fc = 0
local installed = false
local n = 0
local sf, spc, sa, sd, sm, ssp, slabel, sstate, srom = {}, {}, {}, {}, {}, {}, {}, {}, {}

local function mask_to_size(m)
    if m == 0xff then return 1 end
    if m == 0xffff then return 2 end
    if m == 0xffffffff then return 4 end
    local s = 0
    local mm = m or 0
    for _ = 1, 4 do
        if (mm & 0xff) ~= 0 then s = s + 1 end
        mm = mm >> 8
    end
    return s
end

local function install_one(lo, hi, label)
    mem:install_write_tap(lo, hi, "a20_" .. label, function(o, d, m)
        if fc < FROM_FR or fc > TO_FR then return end
        n = n + 1
        if n <= MAX then
            sf[n] = fc
            spc[n] = pc_state.value
            sa[n] = o
            sd[n] = d
            sm[n] = m
            ssp[n] = sp_state.value
            slabel[n] = label
            sstate[n] = string.format(
                "%02x%02x%04x%08x%04x",
                mem:read_u8(BASE + 0x1A),
                mem:read_u8(BASE + 0x36),
                mem:read_u16(BASE + 0x6C),
                mem:read_u32(BASE + 0x6E),
                mem:read_u16(BASE + 0x7A)
            )
            local bytes = {}
            for a = 0x15F58, 0x15F75 do
                bytes[#bytes + 1] = string.format("%02x", mem:read_u8(a))
            end
            srom[n] = table.concat(bytes)
        end
    end)
end

local function install()
    for _, r in ipairs(REGIONS) do
        install_one(r.lo, r.hi, r.label)
    end
end

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
        pc_state = cpu.state["PC"]
        sp_state = cpu.state["SP"]
    end

    fc = fc + 1
    if fc == FROM_FR - 1 and not installed then
        install()
        installed = true
        print(string.format("[a20_full] taps installed; window=%d..%d", FROM_FR, TO_FR))
    end

    if fc > TO_FR then
        local f = assert(io.open(OUT_PATH, "w"))
        f:write("{\n")
        f:write(string.format('  "from_frame": %d,\n', FROM_FR))
        f:write(string.format('  "to_frame": %d,\n', TO_FR))
        f:write(string.format('  "total_writes": %d,\n', n))
        f:write('  "samples": [\n')
        local lim = math.min(n, MAX)
        for i = 1, lim do
            local sep = (i < lim) and "," or ""
            f:write(string.format(
                '    {"f":%d,"pc":"0x%06x","addr":"0x%06x","data":"0x%08x","mask":"0x%08x","size":%d,"sp":"0x%06x","label":"%s","state":"%s","rom15f58":"%s"}%s\n',
                sf[i], spc[i], sa[i], sd[i], sm[i], mask_to_size(sm[i]), ssp[i], slabel[i], sstate[i], srom[i], sep
            ))
        end
        f:write("  ]\n")
        f:write("}\n")
        f:close()
        print(string.format("[a20_full] DONE writes=%d -> %s", n, OUT_PATH))
        manager.machine:exit()
    end
end)

if COMPOSE_PLAYABLE then
    dofile("oracle/mame_playable_input_capture.lua")
end
