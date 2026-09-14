-- Security fix (partial -- see "not addressed" note below): habits.completions
-- accepts a full array replace via a plain client update with zero server-side
-- validation of what dates it contains -- a user can write fabricated future
-- dates (or arbitrarily many past ones) in a single call, which cascades into
-- streaks, freeze eligibility, badge eligibility (award_badge, 20260914090002),
-- and the leaderboard columns locked down in 20260914090004.
--
-- Confirmed via EditWeekDialog.jsx (the app's only completions-editing UI):
-- it only ever shows/toggles the last 14 days (today included) and never a
-- future date -- so rejecting future dates outright cannot break any
-- legitimate flow in this app today. +1 day of grace is kept on top of the
-- server's current_date to cover real client/server timezone skew: a user
-- as far east as UTC+14 can have a local "today" that's one calendar day
-- ahead of the server's UTC current_date, and handleToggleToday/
-- handleCompleteAll (Dashboard.jsx) both stamp completions with the
-- client's own local "today".
--
-- Deliberately NOT addressed here: bounding how many dates can change in a
-- single write, or restricting completions to an append-only RPC. Both
-- were considered and rejected for this pass -- EditWeekDialog sends the
-- caller's ENTIRE completions array back (not just the edited days), so a
-- legitimate save already includes however much historical data the habit
-- has accumulated, and there's no accurate way to distinguish "a real
-- multi-month history" from "a fabricated one" by array size alone without
-- a product decision on what a reasonable bound actually is. Rejecting
-- future dates is the one unambiguous, zero-risk-of-breakage piece of this
-- finding; the rest is left open.
create or replace function public.reject_future_habit_completions()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_max_allowed_date date := current_date + 1;
begin
  if new.completions is not null and exists (
    select 1 from unnest(new.completions) as d
    where d::date > v_max_allowed_date
  ) then
    raise exception 'habits.completions cannot include a date more than one day in the future';
  end if;
  return new;
end;
$$;

create trigger reject_future_habit_completions_trigger
  before insert or update on public.habits
  for each row execute function public.reject_future_habit_completions();
