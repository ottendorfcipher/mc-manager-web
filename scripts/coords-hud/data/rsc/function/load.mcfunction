# Coords HUD — runs once on /reload or server start
# Create objectives (OR IGNORE keeps them if already present)
scoreboard objectives add ch_toggle trigger
scoreboard objectives add ch_x dummy
scoreboard objectives add ch_y dummy
scoreboard objectives add ch_z dummy

# Enable the trigger for every online player so they can use it immediately
scoreboard players enable @a ch_toggle

tellraw @a [{"text":"[Coords HUD] ","color":"green","bold":true},{"text":"Type "},{"text":"/trigger ch_toggle","color":"yellow"},{"text":" to toggle your coordinate display."}]
