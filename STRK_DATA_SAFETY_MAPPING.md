# Strk Data Safety Mapping

**Last updated:** 2026-09-25

Reference table for filling out the Google Play **Data Safety** form and
Apple's **App Privacy** questionnaire (App Store Connect) — Strk ships to
both. This document was drafted from `strk-data-safety-mapping-example.md`
(a template carried over from Sippd) with its open questions resolved
directly against Strk's actual codebase, per that template's own
instruction to do so rather than assume the two apps match. Everything
below marked ✅ is a verified fact, not a guess; items still marked
**[DECISION NEEDED]** are genuine product/business calls only you can
make, not something derivable from the code.

The two forms use different category systems (Google's are broader;
Apple's include a distinct **Health & Fitness** type and a separate
"Data Used to Track You" flag for cross-app/cross-company ad tracking).
Where they'd answer differently, both are noted.

| Data type | What it is | Why it's collected | Linked to identity | Apple category (best-informed mapping — verify against the live App Store Connect form at submission) | Shared with third parties | Required/optional |
|---|---|---|---|---|---|---|
| **Email address** | Login email via Supabase Auth. | Account creation/authentication. | Yes | Contact Info | Supabase; Paddle if subscribed; Resend (to send transactional email). | Required. |
| **Display name** | Shown on leaderboard, group challenges. | Personalization / identifies you to other users. | Yes | Identifiers | Supabase; visible to other users in-App. | ✅ **Required** — onboarding blocks progress until a valid 2–20 character name is set (`OnboardingDisplayName.jsx`); there is no skip option, unlike the example template's open question about matching Sippd. |
| **Habit data** | Habit names, descriptions, categories, completion logs. | Core functionality. | Yes | See "Health & Fitness flag" below | Supabase. Not shared externally. | Required for core use. |
| **Streak data** | Current streak, streak history, streak freezes. | Core functionality / gamification. | Yes | Same category as habit data above | Supabase; visible to others via leaderboard/challenges. | Not user-provided — derived automatically. |
| **Group challenge data** | Which challenges joined/created, your progress, co-members' progress visible to you. | Core functionality — social/competitive features. | Yes | User Content, or same as habit data above if the linked habit is health-related | Supabase; visible to other challenge/group members. | Optional — joining a group or challenge is a choice. |
| **Global leaderboard rank** | Public streak ranking. | Core functionality / gamification. | Yes | Identifiers | Supabase; visible to other users when your profile's `is_public` setting is on. | Not user-provided — derived from usage; controlled by your own `is_public` profile setting, not a separate opt-out. |
| **Push notification data** | N/A. | — | — | — | — | ✅ **Not applicable — Strk sends no push notifications.** Verified: no APNs/FCM/Firebase/OneSignal/web-push integration and no service worker exist anywhere in the codebase. In-app reminders and banners are the only notification surface today. |
| **Subscription/billing data** | Paddle subscription ID, customer ID, price ID, plan/subscription status. | Required to grant/manage Strk Pro. | Yes | Purchase History | Paddle (Merchant of Record); Supabase stores the IDs/status. | Optional — only if subscribed. |
| **Crash/error diagnostics** | Exception messages and stack traces, tagged with internal IDs (user ID, subscription/customer ID) when relevant. | Reliability/debugging (Sentry). | Pseudonymous (internal IDs, not email/name — see note below) | Diagnostics | Sentry. | Not user-provided. |
| **IP address / device info** | Standard request logs at the hosting/CDN layer. | Serving the app, basic infrastructure logging. | No (not tied to your Strk account by us) | Diagnostics | Vercel (web hosting), Supabase (backend infrastructure). | Not user-provided. |

## The one flag that matters most for Strk specifically

**Habit and streak data — Apple's "Health & Fitness" category.**

✅ Verified: Strk's habit categories are `health, fitness, mindfulness,
learning, productivity, social, other` (`supabase/migrations/20260702120002_core_tables.sql`,
enforced by a database check constraint — not just UI copy, so this list
is authoritative). Three of the seven built-in categories are
health/wellness-adjacent by name.

Apple's App Privacy framework has a distinct **Health & Fitness** data
type, separate from generic "User Content," which Apple treats with more
scrutiny than a generic productivity category — including restrictions
on using health data for advertising, even when the data is otherwise
linked to identity for other purposes.

**[DECISION NEEDED]** This app doesn't restrict *what* a user names or
categorizes a habit as — a user can freely log a "Health" or "Mindfulness"
habit alongside a "Productivity" one. Two ways to handle this at App
Store submission, and this is a real product call, not something to
resolve by default:
1. **Conservative:** classify habit/streak data under Health & Fitness
   for the whole app, since the category exists and is used by real
   habits today. Simpler to defend if questioned, but a stricter
   disclosure and ad-data-use posture app-wide.
2. **Narrower:** argue habit-tracking is generic/user-defined (no
   built-in health framing beyond a label), and classify as User Content
   instead. Lower friction, but riskier if Apple's review disagrees —
   there's no guaranteed-safe answer here without either a legal opinion
   or direct precedent from a similar app's accepted submission.

## Sentry — what's actually collected, verified against the code

Unlike the open TODO in the original template, this is now fully
verified rather than assumed, because both the client (`src/lib/sentry.js`)
and every edge function (`supabase/functions/_shared/sentry.ts`) enforce
the same scrubbing:

- No session replay.
- No IP address or geography inference (`dataCollection.userInfo: false`
  on both platforms, plus `event.user` is deleted outright as a backstop
  on every event — nothing in the codebase ever calls `Sentry.setUser()`).
- No request/response bodies or sensitive headers (`Authorization`,
  `apikey`, `cookie`, `x-cron-secret`, `paddle-signature` are redacted
  before an edge-function event is sent).
- A regex backstop strips any email address that happens to appear in an
  error message or context value, on the backend.
- Structured context attached to an error is restricted by convention to
  IDs only (`userId`, `subscriptionId`, `customerId`, `eventType`) — never
  a full user record or request body.

This is meaningfully narrower than a default Sentry integration, and
worth describing precisely rather than generically on both compliance
forms.

## Other resolved flags

- **IP/device info retention:** no Strk-specific retention policy exists
  beyond Vercel's and Supabase's own standard infrastructure log
  retention — same as already disclosed in `PRIVACY_POLICY.md` §8. Not a
  gap; just confirming the mapping table above matches what's already
  public.
- **Third-party product-lookup API:** confirmed no equivalent to Sippd's
  Open Food Facts integration exists in Strk — nothing to add here.
- **Self-service access/export, and progress visibility:** Strk now ships
  in-app data export (Settings → Your data) and a sharing switch
  (Settings → Progress sharing), disclosed in `PRIVACY_POLICY.md` §7.
  Neither changes an answer on Play's Data Safety form: the form asks
  whether users can *request deletion*, which was already true via
  in-app "Delete Account", and it has no field for export at all. Noted
  here so the mapping records that it was checked rather than missed.
  Both do strengthen the "users can manage their data" position if it is
  ever queried.
- **Server-side consent record:** the analytics consent decision is now
  also stored server-side with a timestamp and policy version
  (`analytics_consent_log`, `PRIVACY_POLICY.md` §5, retention in §6). It
  collects no new category of data — it records a choice the user already
  made — so no mapping-table row changes. It is account-scoped and
  cascades on account deletion.

## Notes

- This table assumes the same underlying infrastructure as Sippd
  (Supabase, Vercel, Paddle) per the shared Seedstack Studio stack — that
  assumption held for everything checked above.
- Cross-reference `TERMS_OF_SERVICE.md` and `PRIVACY_POLICY.md` (both in
  this repo's root) — both were updated 2026-09-25 alongside this
  document specifically to disclose Sentry as a processor and keep all
  three consistent. Re-check this mapping if either of those documents
  changes again.
- `PRIVACY_POLICY.md` was updated again 2026-10-26, for the two
  self-service controls and the consent record in the flags above. That
  revision adds user rights and a record of an existing choice; it does
  not change what we collect, how we use it, or who we share it with, so
  no row in the mapping table above moved. `TERMS_OF_SERVICE.md` needed
  no change. Note that `PRIVACY_POLICY.md`'s "Last updated" line is
  pinned to `PRIVACY_POLICY_VERSION` in `src/lib/consentLog.js` by
  `src/lib/consentLog.test.js` — editing the policy without bumping that
  constant fails the test suite, deliberately.
