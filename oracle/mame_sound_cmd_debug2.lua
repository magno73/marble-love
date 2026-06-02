-- mame_sound_cmd_debug2.lua - verifies that coin/start really arrive:
--  - read tap on :1820 (sound CPU) and $F60001 (main) → log every read during pulse
--  - scripted input with a long pulse (60 frames)
--  - status every 200 frames

local TARGET_FRAME = 2400
local COIN_FRAME = 600
local START_FRAME = 900
local PULSE_LEN = 60

local maincpu, audiocpu, ports
local main_mem, sound_mem
local frame_count = 0
local installed = false
local coin_reads = {}
local switch_reads = {}
local fe_writes = 0

local function in_pulse(f, start) return f >= start and f < start + PULSE_LEN end

emu.register_frame_done(function()
    if not installed then
        maincpu = manager.machine.devices[":maincpu"]
        main_mem = maincpu.spaces["program"]
        for _, tag in ipairs({":audiocpu", ":soundcpu"}) do
            if manager.machine.devices[tag] then audiocpu = manager.machine.devices[tag]; break end
        end
        sound_mem = audiocpu.spaces["program"]
        ports = manager.machine.ioport.ports

        -- $1820 ha mirror 0x278f → tap su 0x1000-0x3FFF, filtra mirror match
        sound_mem:install_read_tap(0x1000, 0x3FFF, "coin_r", function(o, d, m)
            if (o & 0xd870) == 0x1820 and in_pulse(frame_count, COIN_FRAME) then
                if #coin_reads < 100 then
                    table.insert(coin_reads, { f = frame_count, a = o, d = d & 0xff })
                end
            end
            return d
        end)
        main_mem:install_read_tap(0xF60000, 0xF60001, "sw_r", function(o, d, m)
            if in_pulse(frame_count, START_FRAME) or in_pulse(frame_count, START_FRAME + 30) then
                if #switch_reads < 100 then
                    table.insert(switch_reads, { f = frame_count, o = o, d = d, m = m })
                end
            end
            return d
        end)
        main_mem:install_write_tap(0xFE0000, 0xFE0001, "snd_cmd_w", function(o, d, m)
            fe_writes = fe_writes + 1
            print(string.format("[FE-WRITE] f%d addr=%06x d=%04x m=%04x", frame_count, o, d, m))
            return d
        end)
        installed = true
        print("[debug2] taps installed")
    end

    frame_count = frame_count + 1

    -- Try BOTH polarities back-to-back to find which works
    if ports then
        if ports[":1820"] and ports[":1820"].fields["Coin 1"] then
            ports[":1820"].fields["Coin 1"]:set_value(in_pulse(frame_count + 1, COIN_FRAME) and 1 or 0)
        end
        if ports[":F60000"] and ports[":F60000"].fields["1 Player Start"] then
            ports[":F60000"].fields["1 Player Start"]:set_value(in_pulse(frame_count + 1, START_FRAME) and 1 or 0)
        end
    end

    if frame_count % 200 == 0 then
        local pcm = maincpu.state["PC"].value
        local pcs = audiocpu and audiocpu.state["PC"] and audiocpu.state["PC"].value or 0
        print(string.format("[debug2] f%d main_pc=%06x snd_pc=%04x fe_writes=%d coin_reads_inpulse=%d sw_reads_inpulse=%d",
            frame_count, pcm, pcs, fe_writes, #coin_reads, #switch_reads))
    end

    if frame_count == COIN_FRAME + 5 then
        -- Log raw coin reads during pulse
        for i = 1, math.min(10, #coin_reads) do
            local r = coin_reads[i]
            print(string.format("[coin-read] f%d data=%02x", r.f, r.d))
        end
    end
    if frame_count == START_FRAME + 35 then
        for i = 1, math.min(10, #switch_reads) do
            local r = switch_reads[i]
            print(string.format("[sw-read] f%d addr=%06x d=%04x m=%04x", r.f, r.o, r.d, r.m))
        end
    end

    if frame_count >= TARGET_FRAME then
        print(string.format("[debug2] FINAL: fe_writes=%d", fe_writes))
        manager.machine:exit()
    end
end)
