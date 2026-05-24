-- Multi-track countdowns + custom-track images + nearest-pin HUD.
--
-- sound_ids_json   – JSON array of sound IDs played in sequence when the
--                    countdown finishes.  When NULL, falls back to sound_id.
-- image_filename   – name of an image stored under
--                    /opt/redstonecipher/www/uploads/music/images/<name>.
--                    NULL when no custom artwork has been uploaded.
ALTER TABLE countdowns           ADD COLUMN sound_ids_json TEXT;
ALTER TABLE music_custom_tracks  ADD COLUMN image_filename TEXT;
