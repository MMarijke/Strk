-- Streak freezes switch from a weekly to a monthly cadence (free tier: 2/month,
-- Pro: unlimited). Renaming the key column to match — existing rows (keyed by
-- old ISO week strings like "2026-W29") are harmless historical data; the app
-- always looks up by the current month key and creates a fresh row if none
-- exists, so no backfill is needed.
alter table public.streak_freezes rename column week_key to month_key;
alter index streak_freezes_owner_week_key rename to streak_freezes_owner_month_key;
