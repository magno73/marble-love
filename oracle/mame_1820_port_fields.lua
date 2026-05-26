-- mame_1820_port_fields.lua — dump Lua-visible fields for the sound $1820 port.

local OUT_PATH = os.getenv("MARBLE_1820_PORT_FIELDS_OUT") or "/tmp/marble_1820_port_fields.json"
local installed = false
local frame_count = 0
local ports

local function escape_json(s)
    return tostring(s):gsub("\\", "\\\\"):gsub('"', '\\"')
end

local function field_value(field, key)
    local ok, value = pcall(function() return field[key] end)
    if ok and value ~= nil then return value end
    ok, value = pcall(function() return field[key](field) end)
    if ok and value ~= nil then return value end
    return nil
end

local function write_fields()
    ports = manager.machine.ioport.ports
    local out = assert(io.open(OUT_PATH, "w"))
    out:write("{\n")
    out:write('  "port": ":1820",\n')
    out:write('  "fields": [\n')
    local first = true
    local port = ports[":1820"]
    if port ~= nil then
        for name, field in pairs(port.fields) do
            if not first then out:write(",\n") end
            first = false
            local mask = field_value(field, "mask")
            local defvalue = field_value(field, "defvalue") or field_value(field, "default_value")
            local value = field_value(field, "value")
            out:write("    {")
            out:write(string.format('"name":"%s"', escape_json(name)))
            if mask ~= nil then out:write(string.format(',"mask":"0x%x"', mask)) end
            if defvalue ~= nil then out:write(string.format(',"default":"0x%x"', defvalue)) end
            if value ~= nil then out:write(string.format(',"value":"0x%x"', value)) end
            out:write("}")
        end
    end
    out:write("\n  ]\n")
    out:write("}\n")
    out:close()
    print(string.format("[1820_port_fields] saved to %s", OUT_PATH))
end

emu.register_frame_done(function()
    if not installed then
        installed = true
        write_fields()
    end
    frame_count = frame_count + 1
    if frame_count > 1 then manager.machine:exit() end
end)
