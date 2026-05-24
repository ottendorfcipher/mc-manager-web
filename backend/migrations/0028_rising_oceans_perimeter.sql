-- Add perimeter shield + customisable water-rise pattern to rising_oceans.
--
-- blocks_per_step   – how many Y levels are filled per interval tick (default 1)
-- perimeter_enforce – when 1, players are TP'd back inside the radius each tick
-- rise_pattern_json – optional JSON array of per-step interval overrides, e.g.
--                     "[30,30,15,15,10]" → 5 steps with custom interval_secs each.
--                     When present, start_y/end_y/interval_secs/blocks_per_step are
--                     ignored and the event runs exactly len(array) steps.
ALTER TABLE rising_oceans ADD COLUMN blocks_per_step   INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rising_oceans ADD COLUMN perimeter_enforce INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rising_oceans ADD COLUMN rise_pattern_json TEXT;
