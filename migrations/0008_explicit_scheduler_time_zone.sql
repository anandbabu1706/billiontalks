ALTER TABLE account_preferences
  ADD COLUMN time_zone_explicit INTEGER NOT NULL DEFAULT 0
  CHECK (time_zone_explicit IN (0, 1));

UPDATE account_preferences
SET time_zone_explicit = 1
WHERE time_zone <> 'UTC'
   OR updated_at > (
     SELECT accounts.updated_at
     FROM accounts
     WHERE accounts.id = account_preferences.account_id
   );
