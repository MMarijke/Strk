# Privacy Policy — Strk

**Effective date:** 2026-08-16
**Last updated:** 2026-10-26

Strk ("Strk," "we," "us," or "our") is a social habit-tracking app operated by
**Seedstack Studio (Pty) Ltd**, a company registered in South Africa
("Seedstack Studio," "we"). This policy explains what personal information
we collect through the Strk app (available via the Apple App Store and
Google Play Store, and at https://strk-seven.vercel.app), why we collect it, who we share it with, and the rights you
have over it.

If you have questions about this policy or want to exercise any of the
rights described below, contact us at **seedstackstudio@gmail.com**.

---

## 1. Who we are

- **Operator:** Seedstack Studio (Pty) Ltd
- **Country of registration:** South Africa
- **Company registration number:** 202636739807
- **Contact:** seedstackstudio@gmail.com

Because we're a South African company serving users worldwide, this policy
is written to satisfy South Africa's **POPIA** (Protection of Personal
Information Act) as well as the **EU/UK GDPR** for users in those regions.
If you're in another jurisdiction with its own privacy law (e.g.
California's CCPA/CPRA), some additional rights may apply to you that
aren't separately itemized below.

## 2. What data we collect

We collect the following categories of data, all tied to your account:

| Category | Specific data | Where it's used in the app |
|---|---|---|
| **Account identity** | Email address (used for magic-link sign-in via Supabase Auth); display name; avatar color | Sign-in, profile, leaderboards |
| **Habit data** | Habit names, categories, colors, completion history (dates), goals, reminder schedule, archive status | Core habit tracking |
| **Streak & freeze history** | Streak counts, best streak, consistency score, monthly freeze usage, which habits were "frozen" and on what date | Streak/freeze feature |
| **Group membership & social connections** | Groups you create or join, other members' email addresses (visible to group members via invite/membership lists), group challenges, reactions (emoji) sent to other members, challenge notifications | Social/groups feature |
| **Focus session data** | Focus session participation, host/participant email and display name, session timing and status | Focus sessions feature |
| **Badge & rank progress** | Earned badges and dates earned, highest rank achieved | Badges/gamification |
| **Payment & subscription status** | Plan (free/Pro), subscription status, and identifiers Paddle assigns to you (customer ID, subscription ID, price ID) so we know what you're subscribed to | Pro subscription gating |
| **Product usage data** | In-app actions such as completing a habit, creating/joining a group, starting a focus session, starting a challenge, and completing sign-up or checkout | Analytics (see §4) |
| **Crash & error diagnostics** | Exception messages and stack traces when something breaks, tagged with internal IDs (your user ID, and a subscription/customer ID if relevant) so we can investigate — never your email address or auth token, which are actively stripped before this leaves the app | Reliability/debugging (Sentry, see §4) |

**What we do *not* collect:** we do not collect or store your payment card
number, bank details, or other raw payment instrument data — that's held
directly by Paddle (see §4). We do not currently collect date of birth,
government ID, or precise location data.

## 3. Why we collect it (purposes & legal basis)

We use your data to:

- Provide the core service — track your habits, streaks, freezes, groups,
  focus sessions, and badges (**contract performance**: necessary to
  deliver the app you signed up for).
- Process your Pro subscription and payments through Paddle (**contract
  performance**).
- Send you transactional email: a welcome email when you finish onboarding,
  and — only if you've turned it on in Settings — a weekly digest
  summarizing your habit completions (**contract performance** /
  **consent**, since the weekly digest is opt-in via the
  `email_weekly_digest` setting).
- Understand how the app is used, via anonymized/pseudonymous product
  analytics (**legitimate interest**, see §4) — e.g. which features get
  used, where people drop off during onboarding.
- Comply with legal and tax obligations related to payment processing
  (**legal obligation**, largely handled by Paddle as Merchant of Record).

## 4. Third parties we share data with

We don't sell your personal information. We share it with the following
service providers ("sub-processors"), each of whom processes it only to
provide their service to us:

### Supabase (database, authentication, backend functions)
Supabase hosts our database, handles magic-link authentication, and runs
our backend ("edge") functions. This is where all the data in the table
above is stored. Our database is hosted on AWS infrastructure in the
**eu-west-1 (Ireland)** region.

### Paddle (payments — Merchant of Record)
Paddle is our payment processor and acts as the **Merchant of Record** for
all Pro subscription purchases — meaning Paddle, not Seedstack Studio, is
legally the seller, and Paddle handles payment collection, card data,
receipts, and global sales tax/VAT compliance on our behalf. We never see
or store your card details; Paddle sends us your subscription status and
plan via webhook so the app can unlock Pro features. Read Paddle's own
privacy policy at [paddle.com/legal/privacy](https://www.paddle.com/legal/privacy).

### PostHog (product analytics)
We use PostHog, hosted on **PostHog Cloud (US region)**, to understand
product usage. When you log in, we send PostHog your Supabase user ID and
email address so your activity can be tied to one profile across sessions.
We track specific named actions (e.g. signing up, creating a habit,
completing a habit, joining a group, starting a focus session, starting a
subscription) — we do not send PostHog your habit names, streak content,
or message/reaction content, and automatic click/form capture is turned
off in our PostHog configuration.

### Resend (transactional email)
We use Resend to deliver the welcome email and the opt-in weekly digest
email described in §3. Resend processes your email address and the email
content (which may include your display name and habit completion
summaries) solely to deliver these messages.

### Vercel (hosting)
Vercel hosts the Strk web app itself. Standard hosting-level data (like IP
address, at the network/CDN level) passes through Vercel's infrastructure
as part of serving the app; Vercel does not otherwise receive your
account or habit data.

### Sentry (error monitoring)
We use Sentry to catch and diagnose crashes and errors, on both the app
itself and our backend functions. This is deliberately configured to
collect as little as possible: we don't enable session replay, we don't
let Sentry infer your IP address or location, and every error report has
your email address and any authorization/API-key headers stripped out
before it's sent — both on the app and on our backend. Where we do attach
identifying context to an error (for example, to investigate a billing
issue), it's limited to internal IDs (your user ID, and a Paddle
subscription/customer ID if relevant), never your email, name, or habit
content.

## 5. Cookies & local storage

The Strk web app uses local/session storage (via Supabase's client library)
to keep you signed in, and PostHog sets its own identifiers (cookies or
local storage, depending on browser support) to track usage as described in
§4.

Your analytics choice itself is stored in your browser's local storage —
that copy is what actually switches analytics on or off, including before
you sign in. Once you're signed in we also record the decision on our
server, with the time and the version of this policy it was made against,
so that there is a durable record of what you chose. That record is
append-only: we can add to it but not edit or delete past entries, and
neither can you. You can change your decision at any time in Settings →
Analytics, which simply adds a new entry.

## 6. How long we keep your data

- Active account data (habits, streaks, groups, etc.): retained for as
  long as your account is active.
- Data after account deletion: see §7.
- Raw Paddle webhook event logs (`paddle_events`): retained indefinitely
  at this time; we may introduce a scheduled purge in the future.
- Your analytics consent history (`analytics_consent_log`, see §5):
  retained for as long as your account exists, and deleted along with it.
  We keep the full history rather than only your current choice, because
  the point of the record is to show what you chose and when.
- Backups: our current hosting plan does not include automated backups.
  If you delete data, it's gone — we have no backup copy to restore from.

## 7. Your rights, and how account deletion actually works

Depending on where you live, you may have rights to access, correct,
export, restrict, object to, or delete your personal information (under
GDPR, POPIA, and similar laws).

Three of these you can exercise yourself, immediately, without asking us:

- **Access and export your data:** Settings → Your data → "Download my
  data" gives you a JSON file containing every row our database holds that
  identifies you — habits, streaks, groups, partnerships, badges, your
  consent history, and your raw Paddle billing events. Shared records (a
  group you joined, a nudge someone sent you) are included as stored, so
  they also name the other person involved — the same information the app
  already shows you.
- **Control who can see your progress:** Settings → Progress sharing
  decides whether the groupmates and accountability partners you've
  joined with can see your streak and consistency. Turning it off changes
  nothing about your own use of Strk.
- **Withdraw analytics consent:** Settings → Analytics, at any time. See
  §5.

For anything else — correction, restriction, objection, or a question
about the above — email **seedstackstudio@gmail.com**.

**Deleting your account:** Tapping "Delete Account" in Settings
permanently and irreversibly deletes your account, including:

- Your login (Supabase Auth account)
- All your habits, streaks, freeze history, and badges
- Groups you created, along with their challenges (if you own a group
  with other members, deleting your account deletes that group for
  everyone — you'll be warned before confirming)
- Your focus session history

We also remove your email address from other users' groups, challenges,
and focus sessions you were a member (not owner) of, and anonymize any
reactions or notifications tied to your email so other users' activity
records stay intact without identifying you.

If you have an active Pro subscription, deleting your account also
cancels it immediately with Paddle.

One thing this doesn't reach: raw Paddle webhook event logs
(`paddle_events`) may still contain your email inside historical payment
records — email us if you'd like these manually removed.

## 8. International data transfers

Because we're a South African company, your Supabase database lives in
the EU, PostHog processes data in the US, and our users are global, your
data may be transferred across borders. We rely on each processor's own
standard safeguards for these transfers — Supabase, Paddle, PostHog,
Resend, and Vercel each publish their own data processing agreements and
standard contractual clauses covering international transfers.

## 9. Children's privacy

Strk is not intended for anyone under 16 years old. We do not knowingly
collect personal information from anyone under 16. If you believe a
child under 16 has created an account, contact us at
seedstackstudio@gmail.com and we'll delete it.

## 10. Security

We rely on Supabase's infrastructure, including Row Level Security (RLS)
policies that restrict each user to their own data, and database-level
triggers that prevent even the app's own client code from directly
modifying billing/subscription status or usage-limit fields — those can
only be changed by our backend (via Paddle's webhook or a dedicated
server-side function), not by any client request. We also use
database-level constraints that prevent even our own client application
from writing certain protected fields except through trusted,
server-verified processes.

## 11. Changes to this policy

We'll update this page if what we collect or how we use it changes, and
update the "Last updated" date above. For material changes —
particularly any that affect how we use your data — we'll also notify
you by email.

## 12. Contact us

Questions, requests to access/correct/delete your data, or complaints:

**Seedstack Studio (Pty) Ltd**
Email: seedstackstudio@gmail.com

If you're in the EU/UK and unsatisfied with our response, you have the
right to lodge a complaint with your local data protection authority. If
you're in South Africa, you may contact the **Information Regulator**
at [inforegulator.org.za](https://inforegulator.org.za).