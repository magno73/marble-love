-- mame_decoder_stream_tap.lua — token-level trace del decoder FUN_1A668
--
-- Per ogni body in window [FROM_FR..TO_FR]:
--  1. Tap WRITE su 0x400700..0x40074F filtrato dai PC del decoder
--     (0x01a6ba A, 0x01a6e8 B, 0x01a714 C, 0x01a748 D, 0x01a778 E).
--     Cattura A0..A7 + D0..D7 + PC + sp al momento di OGNI write.
--  2. Tap READ su 0x000-0xFFFFF program space FILTRATO sui PC del decoder
--     (specifico: 0x1a690 long-read di A3, 0x1a6a8/0x1a6d8/0x1a6fe/0x1a73a/0x1a76a byte-read di A1).
--     Cattura addr e value letti.
--  3. Stack di execution: usa cpu_pc to filter only "inside decoder" reads
--     (range 0x1a668..0x1a797).
--
-- Output JSON: /tmp/mame_decoder_stream.json
--
-- Env vars:
--   MARBLE_TRACE_FROM (default 12000)
--   MARBLE_TRACE_TO   (default 12010)
--   MARBLE_TRACE_OUT  (default /tmp/mame_decoder_stream.json)

local function getenv(name, fallback)
    local v = os.getenv(name)
    if v == nil or v == "" then return fallback end
    return v
end

local FROM_FR  = tonumber(getenv("MARBLE_TRACE_FROM", "12000"))
local TO_FR    = tonumber(getenv("MARBLE_TRACE_TO", "12010"))
local OUT_PATH = getenv("MARBLE_TRACE_OUT", "/tmp/mame_decoder_stream.json")

-- PC writers del decoder (path A/B/C/D/E).
local PC_PATH = {
    [0x1a6ba] = "A",
    [0x1a6e8] = "B",
    [0x1a714] = "C",
    [0x1a748] = "D",
    [0x1a778] = "E",
}

-- PC reader addr critici (estrazione token + ricarica byte cache).
-- Ctrl long-read @ 0x1a690 (move.l (A3),D0)
-- Ext byte-read @ 0x1a6a8 + 0x1a6aa (path A), 0x1a6d8 + 0x1a6da (B),
--                0x1a6fe + 0x1a700 (C), 0x1a73a + 0x1a73c (D), 0x1a76a + 0x1a76c (E)
-- NOTA: pre-fetch instruction reads sono complicate da intercettare per PC esatto;
-- piu' utile registrare D0 SUBITO DOPO move.l (A3),D0 — cioe' al passaggio @ 0x1a692
-- (next instruction). Usiamo emu.debugger or hook on PC? In MAME Lua semplice: register
-- snapshot dei regs ad ogni write decoder. Ricostruiamo D0/D1/D5/D6 dalla sequenza di write.

-- Per leggere stream content: facciamo snapshot BEGIN body (PC entra in 0x1a668)
-- usando emu.register_periodic con check PC. Meglio: install_passthrough_tap
-- su READ range 0x800e4..0x9ffff (ctrl stream area) e 0x2be18..0x2cfff (ext stream),
-- filtrato per cpu_pc nel range decoder.

local DECODER_LO = 0x1a668
local DECODER_HI = 0x1a797

local cpu = nil
local mem = nil
local cpu_pc, cpu_sp = nil, nil
local reg_a, reg_d = {}, {}

local frame_count = 0
local installed = false

-- Writes nel range 0x400700..0x40074F (output buffer + tail) durante decoder.
local writes = {}        -- {f, body_idx, pc, addr, data, mask, sp, a={}, d={}}
local body_idx = 0       -- inkrementa ad ogni new body entry @ 0x1a668
local in_decoder = false

-- Stream reads (ctrl + ext) dal solo decoder.
local stream_reads = {}  -- {f, body_idx, pc, addr, value, kind="ctrl"|"ext"}

-- Body entry/exit snapshots (regs al PC=0x1a668 e al PC=0x1a796).
local body_entries = {}  -- {f, idx, pc=0x1a668, a={}, d={}, sp}
local body_exits = {}    -- {f, idx, pc=0x1a796, a={}, d={}, sp}

-- Ctrl/Ext stream snapshot READS — usiamo tap su tutti i read da program space
-- e filtriamo per PC dentro range decoder. Per limitare overhead taggiamo solo
-- il range [0x80000..0x90000] U [0x2be18..0x2c800].
-- In realta' il decoder legge da addr = ctrlBase+offset. ctrlBase = 0x800e4 +
-- sext(tileWord) — puo' essere anywhere. Per essere safe taggiamo tutto fino
-- a 0x88000 (ROM end) per la window mirata.

local function snapshot_regs()
    local a, d = {}, {}
    for k = 0, 7 do
        a[k+1] = reg_a[k].value
        d[k+1] = reg_d[k].value
    end
    return a, d
end

local function install_taps()
    -- Write tap su decode buffer.
    mem:install_write_tap(0x400700, 0x40074F, "dec_writes", function(o, data, mask)
        if frame_count < FROM_FR or frame_count > TO_FR then return end
        local pc = cpu_pc.value
        if PC_PATH[pc] == nil then return end
        local a, d = snapshot_regs()
        writes[#writes+1] = {
            f = frame_count, body_idx = body_idx,
            pc = pc, addr = o, data = data, mask = mask,
            sp = cpu_sp.value, a = a, d = d, path = PC_PATH[pc],
        }
    end)

    -- Read tap su ROM (ctrl + ext stream range).
    -- Decoder e' attivo solo se PC e' nel range. Limita overhead.
    mem:install_read_tap(0x00000, 0x87FFF, "dec_reads", function(o, data, mask)
        if frame_count < FROM_FR or frame_count > TO_FR then return end
        local pc = cpu_pc.value
        if pc < DECODER_LO or pc > DECODER_HI then return end
        -- Esclude letture di instruction fetch del decoder stesso (0x1a668..0x1a797).
        if o >= DECODER_LO and o <= DECODER_HI then return end
        -- Esclude letture lookup table ROM (0x2499a..0x249e9).
        if o >= 0x24990 and o <= 0x249ea then
            stream_reads[#stream_reads+1] = {
                f = frame_count, body_idx = body_idx, pc = pc,
                addr = o, value = data, mask = mask, kind = "table",
            }
            return
        end
        -- Tutto il resto e' ctrl/ext stream content.
        local kind = "?"
        if o >= 0x800e4 and o < 0x2be18 then kind = "ctrl"
        elseif o >= 0x2be18 and o < 0x88000 then kind = "ext"
        end
        stream_reads[#stream_reads+1] = {
            f = frame_count, body_idx = body_idx, pc = pc,
            addr = o, value = data, mask = mask, kind = kind,
        }
    end)
end

-- Body entry/exit detection: hook on every frame, check PC progression.
-- Simpler: install_read_tap on 0x1a668 (instruction fetch). When CPU executes
-- @ 0x1a668, PC reads that addr as instruction. We just count entries.
local function install_body_marker()
    mem:install_read_tap(0x1a668, 0x1a669, "dec_entry", function(o, data, mask)
        if frame_count < FROM_FR or frame_count > TO_FR then return end
        if cpu_pc.value ~= 0x1a668 then return end
        body_idx = body_idx + 1
        local a, d = snapshot_regs()
        body_entries[#body_entries+1] = {
            f = frame_count, idx = body_idx, pc = 0x1a668, sp = cpu_sp.value, a = a, d = d,
        }
        in_decoder = true
    end)
    mem:install_read_tap(0x1a796, 0x1a797, "dec_exit", function(o, data, mask)
        if frame_count < FROM_FR or frame_count > TO_FR then return end
        if cpu_pc.value ~= 0x1a796 then return end
        local a, d = snapshot_regs()
        body_exits[#body_exits+1] = {
            f = frame_count, idx = body_idx, pc = 0x1a796, sp = cpu_sp.value, a = a, d = d,
        }
        in_decoder = false
    end)
end

local function dump_json()
    local f = assert(io.open(OUT_PATH, "w"))
    f:write("{\n")
    f:write(string.format('  "from_frame": %d,\n', FROM_FR))
    f:write(string.format('  "to_frame": %d,\n', TO_FR))
    f:write(string.format('  "total_writes": %d,\n', #writes))
    f:write(string.format('  "total_reads": %d,\n', #stream_reads))
    f:write(string.format('  "total_body_entries": %d,\n', #body_entries))

    f:write('  "body_entries": [\n')
    for i, b in ipairs(body_entries) do
        local sep = (i < #body_entries) and "," or ""
        f:write(string.format(
            '    {"f":%d,"idx":%d,"sp":"0x%x",' ..
            '"a":["0x%x","0x%x","0x%x","0x%x","0x%x","0x%x","0x%x","0x%x"],' ..
            '"d":["0x%x","0x%x","0x%x","0x%x","0x%x","0x%x","0x%x","0x%x"]}%s\n',
            b.f, b.idx, b.sp,
            b.a[1], b.a[2], b.a[3], b.a[4], b.a[5], b.a[6], b.a[7], b.a[8],
            b.d[1], b.d[2], b.d[3], b.d[4], b.d[5], b.d[6], b.d[7], b.d[8],
            sep
        ))
    end
    f:write('  ],\n')

    f:write('  "body_exits": [\n')
    for i, b in ipairs(body_exits) do
        local sep = (i < #body_exits) and "," or ""
        f:write(string.format(
            '    {"f":%d,"idx":%d,"sp":"0x%x",' ..
            '"a":["0x%x","0x%x","0x%x","0x%x","0x%x","0x%x","0x%x","0x%x"],' ..
            '"d":["0x%x","0x%x","0x%x","0x%x","0x%x","0x%x","0x%x","0x%x"]}%s\n',
            b.f, b.idx, b.sp,
            b.a[1], b.a[2], b.a[3], b.a[4], b.a[5], b.a[6], b.a[7], b.a[8],
            b.d[1], b.d[2], b.d[3], b.d[4], b.d[5], b.d[6], b.d[7], b.d[8],
            sep
        ))
    end
    f:write('  ],\n')

    f:write('  "writes": [\n')
    for i, w in ipairs(writes) do
        local sep = (i < #writes) and "," or ""
        f:write(string.format(
            '    {"f":%d,"idx":%d,"pc":"0x%06x","path":"%s","addr":"0x%06x","data":"0x%08x","mask":"0x%08x","sp":"0x%x",' ..
            '"a":["0x%x","0x%x","0x%x","0x%x","0x%x","0x%x","0x%x","0x%x"],' ..
            '"d":["0x%x","0x%x","0x%x","0x%x","0x%x","0x%x","0x%x","0x%x"]}%s\n',
            w.f, w.body_idx, w.pc, w.path, w.addr, w.data, w.mask, w.sp,
            w.a[1], w.a[2], w.a[3], w.a[4], w.a[5], w.a[6], w.a[7], w.a[8],
            w.d[1], w.d[2], w.d[3], w.d[4], w.d[5], w.d[6], w.d[7], w.d[8],
            sep
        ))
    end
    f:write('  ],\n')

    f:write('  "reads": [\n')
    for i, r in ipairs(stream_reads) do
        local sep = (i < #stream_reads) and "," or ""
        f:write(string.format(
            '    {"f":%d,"idx":%d,"pc":"0x%06x","addr":"0x%06x","value":"0x%08x","mask":"0x%08x","kind":"%s"}%s\n',
            r.f, r.body_idx, r.pc, r.addr, r.value, r.mask, r.kind, sep
        ))
    end
    f:write('  ]\n')
    f:write("}\n")
    f:close()
end

emu.register_frame_done(function()
    if cpu == nil then
        cpu = manager.machine.devices[":maincpu"]
        mem = cpu.spaces["program"]
        cpu_pc = cpu.state["PC"]
        cpu_sp = cpu.state["SP"]
        for k = 0, 7 do
            reg_a[k] = cpu.state[string.format("A%d", k)]
            reg_d[k] = cpu.state[string.format("D%d", k)]
        end
    end

    frame_count = frame_count + 1

    if frame_count == FROM_FR - 1 and not installed then
        install_taps()
        install_body_marker()
        installed = true
        print(string.format("[dec_stream] taps installed frames=%d..%d", FROM_FR, TO_FR))
    end

    if frame_count % 2000 == 0 then
        print(string.format("[dec_stream] fc=%d writes=%d reads=%d bodies=%d",
            frame_count, #writes, #stream_reads, #body_entries))
    end

    if frame_count > TO_FR then
        dump_json()
        print(string.format("[dec_stream] DONE writes=%d reads=%d bodies=%d -> %s",
            #writes, #stream_reads, #body_entries, OUT_PATH))
        manager.machine:exit()
    end
end)
