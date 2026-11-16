-- Runs only the data stages of trusted official game data; does not run the game.
local root, profile, output, version = assert(arg[1]), assert(arg[2]), assert(arg[3]), assert(arg[4])
assert(profile=='base' or profile=='space-age','Unknown profile')
local active = 'core'
local cache = {}
local function exists(p) local f=io.open(p); if f then f:close(); return true end end
function require(name)
  local mod, rel = name:match('^__(.-)__[/%.](.*)$')
  local candidates = {}
  local function add(m,r) candidates[#candidates+1]={root..'/'..m..'/'..r..'.lua',m} end
  if mod then
    add(mod,rel:gsub("%.","/"))
  else
    rel=name:gsub('%.','/')
    add(active,rel)
    add('core','lualib/'..rel)
    add('core',rel)
    add('base',rel)
  end
  for _,candidate in ipairs(candidates) do
    local file, context = candidate[1],candidate[2]
    if exists(file) then
      if cache[file]~=nil then return cache[file] end
      local previous=active; active=context
      cache[file]=true
      local chunk,err=loadfile(file); assert(chunk,err)
      local result=chunk()
      active=previous
      if result~=nil then cache[file]=result end
      return cache[file]
    end
  end
  error('Module not found: '..name..' from '..active)
end
log=function(message) io.stderr:write(tostring(message)..'\n') end
serpent={block=function() return '[table]' end,line=function() return '[table]' end}
table_size=function(t) local n=0; for _ in pairs(t) do n=n+1 end; return n end
mods={base=version}
local packs={'core','base'}
if profile=='space-age' then
  packs={'core','base','elevated-rails','quality','recycler','space-age'}
  for _,pack in ipairs(packs) do mods[pack]=version end
end
local expanded=profile=='space-age'
feature_flags={quality=expanded,space_travel=expanded,spoiling=expanded,freezing=expanded,segmented_units=expanded,expansion_shaders=expanded,rail_bridges=expanded}
settings={startup={}}
defines={direction={north=0,northnortheast=1,northeast=2,eastnortheast=3,east=4,eastsoutheast=5,southeast=6,southsoutheast=7,south=8,southsouthwest=9,southwest=10,westsouthwest=11,west=12,westnorthwest=13,northwest=14,northnorthwest=15},constant={default_icon_size=64},prototypes={}}
defines.inventory={beacon_modules=1,character_armor=2,character_main=3,character_trash=4,crafter_modules=5,fuel=6,lab_input=7,lab_modules=8,turret_ammo=9}
defines.controllers={character=1,god=2,spectator=3,remote=4,cutscene=5}
defines.wire_connector_id={power_switch_left_copper=1,power_switch_right_copper=2}
local hierarchy=require('prototype-hierarchy')
local function collect(node,out)
  for name,child in pairs(node) do
    if name~='_abstract' then
      if not child._abstract then out[name]=name end
      collect(child,out)
    end
  end
end
-- Inventory/controller/connector IDs above occur only in discarded graphics
-- positioning and simulation strings. They are not exported or used to filter signals.
for base,node in pairs(hierarchy) do
  local out={}; if not node._abstract then out[base]=base end
  collect(node,out); defines.prototypes[base]=out
end
-- Native Lua randomizes string hash traversal between processes. Snapshot and
-- sort keys so generated catalogs are reproducible, including recipe generators
-- that insert into the table being traversed. This is an offline data loader,
-- not a replacement for Factorio's engine validation or GUI visibility rules.
local native_pairs = pairs
function pairs(t)
  local keys = {}
  for k in native_pairs(t) do keys[#keys+1] = k end
  table.sort(keys, function(a,b)
    if type(a) == type(b) and (type(a)=='number' or type(a)=='string') then return a < b end
    return type(a)..tostring(a) < type(b)..tostring(b)
  end)
  local index = 0
  return function()
    repeat index=index+1 until index>#keys or t[keys[index]]~=nil
    if index<=#keys then return keys[index], t[keys[index]] end
  end
end
require('util')
require('dataloader')
for _,phase in ipairs({'data.lua','data-updates.lua','data-final-fixes.lua'}) do
  for _,pack in ipairs(packs) do
    local file=root..'/'..pack..'/'..phase
    if exists(file) then
      active=pack
      io.stderr:write('Loading '..pack..'/'..phase..'\n')
      assert(loadfile(file))()
    end
  end
end
local function escape(s)
 return '"'..s:gsub('[%z\1-\31\\"]',function(c)
   local replacements={['"']='\\"',['\\']='\\\\',['\n']='\\n',['\r']='\\r',['\t']='\\t'}
   return replacements[c] or string.format('\\u%04x',c:byte())
 end)..'"'
end
local function encode(v,seen)
 local t=type(v)
 if t=='nil' then return 'null' end
 if t=='string' then return escape(v) end
 if t=='number' or t=='boolean' then return tostring(v) end
 assert(t=='table','Unsupported JSON type '..t)
 seen=seen or {}; assert(not seen[v],'JSON cycle'); seen[v]=true
 local keys={}; for k in pairs(v) do keys[#keys+1]=k end
 table.sort(keys,function(a,b) return tostring(a)<tostring(b) end)
 local isarray=#keys>0
 for _,k in ipairs(keys) do if type(k)~='number' or k<1 or k>#keys or math.floor(k)~=k then isarray=false end end
 local items={}
 if isarray then
  for i=1,#keys do items[#items+1]=encode(v[i],seen) end
 else
  for _,k in ipairs(keys) do items[#items+1]=escape(tostring(k))..':'..encode(v[k],seen) end
 end
 seen[v]=nil
 if isarray then return '['..table.concat(items,',')..']' end
 return '{'..table.concat(items,',')..'}'
end
local fields={'type','name','localised_name','localised_description','icon','icons','icon_size','subgroup','order','flags','hidden','hidden_in_factoriopedia','parameter','stack_size','weight','place_result','place_as_equipment_result','main_product','results','group','level','next','next_probability','rocket_launch_products','rocket_launch_product','default_import_location','hide_from_signal_gui','factoriopedia_alternative','draw_sprite_by_default','show_in_tooltip'}
local raw={}
for kind,prototypes in pairs(data.raw) do
 local base
 for parent,types in pairs(defines.prototypes) do if types[kind] then base=parent; break end end
 if base=='item' or base=='entity' or base=='space-location' or kind=='fluid' or kind=='virtual-signal' or kind=='recipe' or kind=='asteroid-chunk' or kind=='quality' or kind=='item-group' or kind=='item-subgroup' then
   raw[kind]={}
   for name,p in pairs(prototypes) do
     local filtered={}; for _,field in ipairs(fields) do filtered[field]=p[field] end
     filtered.base_type=base
     raw[kind][name]=filtered
   end
 end
end
local f=assert(io.open(output,'w')); f:write(encode(raw),'\n'); f:close()
