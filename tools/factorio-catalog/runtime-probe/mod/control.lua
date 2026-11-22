local dictionaries = {
  item = "item", fluid = "fluid", virtual = "virtual_signal", entity = "entity",
  recipe = "recipe", ["space-location"] = "space_location",
  ["asteroid-chunk"] = "asteroid_chunk", quality = "quality"
}

local function property(prototype, key, map)
  local ok, value = pcall(function() return prototype[key] end)
  if not ok then return {status = "unsupported"} end
  if value == nil then return {status = "absent"} end
  if map then value = map(value) end
  return {status = "present", value = value}
end

script.on_init(function()
  local result = {schemaVersion = 1, activeMods = script.active_mods, rows = {}}
  for signal_type, dictionary in pairs(dictionaries) do
    local ok, entries = pcall(function() return prototypes[dictionary] end)
    if ok then
      for name, prototype in pairs(entries) do
        local row = {
          id = signal_type .. "/" .. name,
          type = signal_type, name = name, prototypeType = prototype.type,
          hidden = property(prototype, "hidden"), parameter = property(prototype, "parameter"),
          subgroup = property(prototype, "subgroup", function(value) return value.name end),
          group = property(prototype, "group", function(value) return value.name end),
          order = property(prototype, "order"), localisedName = property(prototype, "localised_name")
        }
        if signal_type == "entity" then
          row.selectableInGame = property(prototype, "selectable_in_game")
          row.flags = property(prototype, "flags")
          row.itemsToPlaceThis = property(prototype, "items_to_place_this")
        end
        if signal_type == "recipe" or signal_type == "asteroid-chunk" then
          row.hideFromSignalGui = property(prototype, "hide_from_signal_gui")
        end
        if signal_type == "asteroid-chunk" then
          row.itemSignalAlias = property(prototype, "item_signal_alias", function(value) return value.name end)
        end
        result.rows[#result.rows + 1] = row
      end
    end
  end
  table.sort(result.rows, function(a,b) return a.id < b.id end)
  helpers.write_file("runtime.json", helpers.table_to_json(result), false)
  log("f logic prototype probe: " .. #result.rows .. " rows exported")
end)
