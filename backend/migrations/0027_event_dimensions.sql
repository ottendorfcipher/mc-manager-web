-- Add dimension columns to countdowns for arena teleportation.
ALTER TABLE countdowns ADD COLUMN pregame_dimension TEXT;
ALTER TABLE countdowns ADD COLUMN target_dimension TEXT;
ALTER TABLE countdowns ADD COLUMN world_border_size INTEGER;
