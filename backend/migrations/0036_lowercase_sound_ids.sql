-- Minecraft resource locations must be lowercase.
-- Normalise any mixed-case sound_ids created before the sanitiser was fixed.

-- 1. Custom tracks table (sound_id is the PK)
UPDATE music_custom_tracks
   SET sound_id = LOWER(sound_id)
 WHERE sound_id != LOWER(sound_id);

-- 2. Music queue entries
UPDATE music_queue
   SET sound_id = LOWER(sound_id)
 WHERE sound_id != LOWER(sound_id);

-- 3. Music zones — sound_ids_json is a JSON array of strings
UPDATE music_zones
   SET sound_ids_json = LOWER(sound_ids_json)
 WHERE sound_ids_json != LOWER(sound_ids_json);
