# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Friend groups who want habit-building to be social. The primary user isn't
looking for a private checklist — they specifically want their habits to be
visible to and shared with real friends: inviting people into groups, running
group challenges together, reacting to each other's progress, and showing up
for scheduled focus sessions at the same time as someone else. Solo tracking
is supported but is not the reason this user picks Strk over a simpler
tracker.

## Product Purpose

Strk is a habit-tracking app whose core mechanism for follow-through is
real-time social accountability rather than private willpower. Users build
daily/weekly habit streaks, but the product's distinct bet is that streaks
survive longer when friends can see them, react to them, and join you in the
moment (a synchronized focus session) rather than just log them alone.

## Positioning

Real-time social accountability: groups, group challenges, emoji reactions
between friends, and live synchronized focus sessions turn habit-building
into a shared, live activity. A solo-tracking competitor (Habitica, Streaks,
Way of Life) would have to become a different, more social product to
credibly copy this — it isn't a bolt-on social feed, it's the mechanism the
whole app is organized around.

## Operating Context

Mobile-first installable PWA (manifest declares `standalone` display; real
app icons already exist at `/icons/icon-192.png` and `/icons/icon-512.png`).
Used in short, frequent sessions: check off today's habits, glance at
friends'/group progress, react, join a scheduled focus session. Auth is
traditional email+password (Supabase `signUp`/`signInWithPassword`). Signup
requires no email confirmation step before entry, so new users get instant
access after creating an account.

## Capabilities and Constraints

- Daily or weekly habit tracking with streak counting.
- Streak freezes: 2 per month on Free, unlimited on Pro (server-enforced
  limit, not just a client-side check).
- Groups and group challenges (7/14/30-day) for shared accountability;
  Free caps the number of groups, Pro removes the cap.
- Emoji reactions sent between friends on their habit activity.
- Focus sessions: synchronized 25/45/60-minute timed sessions joined by
  session code, with a live lobby before the timer starts.
- Trends/analytics: limited history on Free, full 12-week window on Pro.
- Badge and rank gamification tied to streak/consistency history.
- Billing via Paddle (Merchant of Record — handles global tax/VAT), Free
  and Pro (Monthly/Annual) plans. Live pricing is fetched from Paddle at
  request time, never hardcoded — the public pricing surface must do the
  same, not display a remembered number.
- Undecided/not to invent: exact Free-tier group-count cap is enforced
  server-side but its specific number wasn't confirmed for this record —
  don't state a number publicly without checking `apply_streak_freeze`'s
  sibling limits or asking.

## Brand Commitments

- Name: **Strk**. Brand mark: flame emoji (🔥). Existing tagline, already
  shipped in `manifest.json` and `Login.jsx`: "Build streaks. Stay
  accountable." — reuse rather than replace unless asked.
- Default visual theme is the warm ember/amber "Strk" theme (see
  `COLOR_THEMES` in `src/lib/ThemeContext.jsx` — primary ~34° orange/amber,
  cream background), already established across Login and onboarding.
  Other theme options exist (Forest, Ocean, Lavender, Rose, Sunset, Mint)
  but the ember theme is the brand default for anything public-facing.

## Evidence on Hand

- Live product pricing exists and must be sourced live from Paddle
  (`src/hooks/usePaddlePrices.js`) — no invented price numbers.
- No testimonials, customer logos, press mentions, or case studies exist.
  Do not fabricate any of these for the public page.
- Legal copy (Terms of Service, Privacy Policy) already exists and is
  public at `/terms` and `/privacy`, including refund/cancellation terms
  and a contact address (seedstackstudio@gmail.com) — this satisfies
  contact-reachability requirements already; don't duplicate contact
  details unless it genuinely improves the page.

## Product Principles

1. Progress is meant to be witnessed, not just logged — every core
   mechanic (groups, reactions, focus sessions) exists to make a habit
   visible to real friends, not to add a social veneer on a private
   tracker.
2. Entry has to stay low-friction — a short email+password form with
   instant access (no email confirmation gate), not a long signup — and
   the public page should not contradict that by feeling like a heavier
   sales funnel than the product itself.
3. Free is a genuinely usable product, not a stripped demo: Pro removes
   caps and limits (unlimited groups/freezes, full analytics window)
   rather than unlocking core mechanics that Free users can't access at
   all. Public pricing copy should reflect that honestly.
4. Paddle as Merchant of Record is a real operating constraint (global
   tax/compliance handling), not a marketing differentiator — it shouldn't
   be foregrounded on the public page.
