# Read current XYZ into score objectives (truncated to integer, which is correct)
execute store result score @s ch_x run data get entity @s Pos[0]
execute store result score @s ch_y run data get entity @s Pos[1]
execute store result score @s ch_z run data get entity @s Pos[2]

# Push to the action bar — visible above the hotbar, invisible to other players
title @s actionbar [{"text":"X ","color":"gray"},{"score":{"name":"@s","objective":"ch_x"},"color":"yellow"},{"text":"  Y ","color":"gray"},{"score":{"name":"@s","objective":"ch_y"},"color":"green"},{"text":"  Z ","color":"gray"},{"score":{"name":"@s","objective":"ch_z"},"color":"aqua"}]
