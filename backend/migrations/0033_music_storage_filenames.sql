-- Store music file paths under unguessable UUID-prefixed names so the public
-- /uploads/music/ URLs aren't trivially scrapable by knowing the sound ID.
--
-- storage_filename : "{uuid}.ogg" — the on-disk name under
--                    /opt/redstonecipher/www/uploads/music/
-- (image_filename already exists; backfill renames legacy entries to use
--  UUIDs too — see the startup migrator in `music::backfill_uuid_storage`.)
ALTER TABLE music_custom_tracks ADD COLUMN storage_filename TEXT;
