# Snapshot the current state with a temp tag BEFORE modifying anything.
# This prevents the double-evaluation problem where removing a tag makes
# the "unless" branch fire immediately in the same function.
execute if entity @s[tag=ch_on] run tag @s add ch_was_on
execute if entity @s[tag=ch_on] run tag @s remove ch_on

# Branch: was OFF → turn ON
execute unless entity @s[tag=ch_was_on] run tag @s add ch_on
execute unless entity @s[tag=ch_was_on] run tellraw @s [{"text":"[Coords] ","color":"gray"},{"text":"ON","color":"green","bold":true}]

# Branch: was ON → confirm OFF
execute if entity @s[tag=ch_was_on] run tellraw @s [{"text":"[Coords] ","color":"gray"},{"text":"OFF","color":"red","bold":true}]

# Clean up temp tag and reset the trigger to 0
tag @s remove ch_was_on
scoreboard players set @s ch_toggle 0
