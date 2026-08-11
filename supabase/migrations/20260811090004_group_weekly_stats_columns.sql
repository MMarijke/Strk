-- Group weekly report showed each viewer their own real numbers (thisWeek/
-- prevWeek completion rate, top habit) and hardcoded zeros / the viewer's
-- own data mislabeled as group-wide for every other member -- same root
-- cause as the group leaderboard fix (20260811090002), just for
-- week-scoped data instead of all-time/rolling data.
--
-- That trigger can't serve this: best_streak is an all-time high-water
-- mark, consistency_score is a 30-day window rolling from *today*, neither
-- has any notion of "completions within this specific closed Mon-Sun
-- week" or "the week before that". Weekly rankings need their own
-- tracking, computed once per closed week rather than live per habit
-- write -- which is exactly what send-weekly-digest (a cron job, already
-- running weekly with service_role access to every user's real habits)
-- is extended to populate.
--
-- All four nullable, no default: NULL means "no digest run has covered
-- this user yet" (new signup, or added habits after the last Monday run),
-- distinct from a genuine 0%/no top habit -- same hasData-style distinction
-- as the leaderboard fix, so the UI can show "no data yet" instead of a
-- fabricated zero.
alter table public.user_profiles
  add column last_week_completion_rate integer,
  add column prev_week_completion_rate integer,
  add column last_week_top_habit_name text,
  add column last_week_top_habit_count integer;
