# Process any players who triggered the toggle this tick
execute as @a[scores={ch_toggle=1..}] run function rsc:toggle

# Re-enable the trigger so players can use it again next tick
scoreboard players enable @a ch_toggle

# Update coords and push action-bar display for opted-in players only
execute as @a[tag=ch_on] at @s run function rsc:display
