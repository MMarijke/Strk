# Privacy Policy — Strk

**Effective date:** [NEEDS REVIEW — insert the date this policy is actually published/goes live]
**Last updated:** 2026-07-30

Strk ("Strk," "we," "us," or "our") is a social habit-tracking app operated by
**Seedstack Studio (Pty) Ltd**, a company registered in South Africa
("Seedstack Studio," "we"). This policy explains what personal information
we collect through the Strk app (available via the Apple App Store and
Google Play Store, and at [NEEDS REVIEW — insert web app domain if
applicable]), why we collect it, who we share it with, and the rights you
have over it.

If you have questions about this policy or want to exercise any of the
rights described below, contact us at **seedstackstudio@gmail.com**.

---

## 1. Who we are

- **Operator:** Seedstack Studio (Pty) Ltd
- **Country of registration:** South Africa
- **Company registration number:** [NEEDS REVIEW]
- **Registered address:** [NEEDS REVIEW]
- **Contact:** seedstackstudio@gmail.com

Because we're a South African company serving users worldwide, this policy
is written to satisfy South Africa's **POPIA** (Protection of Personal
Information Act) as well as the **EU/UK GDPR** for users in those regions.
If you're in another jurisdiction with its own privacy law (e.g.
California's CCPA/CPRA), some additional rights may apply to you that
aren't separately itemized below — [NEEDS REVIEW: confirm with counsel
whether a dedicated US-state-law section is needed given your actual user
base].

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
plan via webhook so the app can unlock Pro features. [NEEDS REVIEW: link
to Paddle's own privacy policy — https://www.paddle.com/legal/privacy].

### PostHog (product analytics)
We use PostHog, hosted on **PostHog Cloud (US region)**, to understand
product usage. When you log in, we send PostHog your Supabase user ID and
email address so your activity can be tied to one profile across sessions.
We track specific named actions (e.g. signing up, creating a habit,
completing a habit, joining a group, starting a focus session, starting a
subscription) — we do not send PostHog your habit names, streak content,
or message/reaction content. [NEEDS REVIEW: confirm whether PostHog's
default autocapture (automatic click/form tracking) is enabled in your
PostHog project settings — if so, this section should be updated to
reflect that additional UI interaction data may be captured beyond the
named events listed here.]

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

[NEEDS REVIEW: list any additional processors not covered above — e.g.
customer support tooling, crash reporting/error monitoring, app store
analytics (Apple/Google) — if/when added.]

## 5. Cookies & local storage

The Strk web app uses local/session storage (via Supabase's client library)
to keep you signed in, and PostHog sets its own identifiers (cookies or
local storage, depending on browser support) to track usage as described in
§4. [NEEDS REVIEW: confirm whether a cookie-consent banner is implemented
for EU/UK visitors, and whether PostHog is configured to respect
Do-Not-Track or a consent gate before initializing — as of this writing,
analytics initializes automatically on app load without a separate consent
prompt, which may need addressing for GDPR compliance depending on how
"strictly necessary" your legal reviewer considers product analytics to
be.]

## 6. How long we keep your data

[NEEDS REVIEW: this section needs actual retention periods decided and
inserted. Suggested structure to fill in:]

- Active account data (habits, streaks, groups, etc.): retained for as
  long as your account is active.
- Data after account deletion: see §7 — **note the current gap described
  there** before publishing a specific retention promise.
- Raw Paddle webhook event logs (`paddle_events`): [NEEDS REVIEW — how
  long are these retained? Currently kept indefinitely with no automatic
  purge in the codebase.]
- Backups: [NEEDS REVIEW — how long do Supabase backups retain deleted
  data after a user-initiated deletion?]

## 7. Your rights, and how account deletion actually works

Depending on where you live, you may have rights to access, correct,
export, restrict, object to, or delete your personal information (under
GDPR, POPIA, and similar laws). To exercise any of these, email
**seedstackstudio@gmail.com**.

**⚠️ [NEEDS REVIEW — important, please read before publishing]:**
As implemented today, tapping "Delete Account" in Settings only deletes
your rows in the `habits` and `user_profiles` tables, then signs you out.
It does **not** currently delete:

- Your Supabase Auth account itself (your email/login record persists)
- Your group memberships, group challenges, and reactions
- Your focus session history
- Your streak-freeze history
- Your earned badges
- Raw Paddle webhook records tied to your email/customer ID

This is a real gap between what a privacy policy typically promises
("deleting your account deletes your data") and what the product currently
does. Before publishing this policy, you should either:

1. **Fix the deletion flow** — e.g. have "Delete Account" call an admin
   deletion endpoint that removes the `auth.users` row via Supabase's
   Auth admin API. The database already has `on delete cascade` set up
   from `auth.users` to every one of these tables, so deleting the auth
   user would automatically clean up everything else in one step — this
   is very likely the right fix, not just documentation; or
2. **Explicitly scope down the promise** in this policy to match current
   behavior (e.g. "deleting your account removes your habits and profile;
   some social/activity data tied to other users, such as group
   membership records, may take up to N days to fully remove — contact us
   for full erasure"), while treating (1) as a near-term follow-up.

Given GDPR's "right to erasure" and POPIA's similar deletion rights, option
1 is the safer long-term choice. Until it's fixed, this policy should not
claim full automatic data deletion without describing the manual
follow-up you'll do for anyone who emails asking for complete erasure.

## 8. International data transfers

Because we're a South African company, your Supabase database lives in the
EU, PostHog processes data in the US, and our users are global, your data
may be transferred across borders. [NEEDS REVIEW: confirm the specific
safeguards in place — e.g. Standard Contractual Clauses with each
processor — for POPIA's cross-border transfer requirements (condition 72)
and GDPR Chapter V. This typically just means confirming each processor's
existing DPA/SCCs (Supabase, Paddle, PostHog, Resend, Vercel all publish
standard ones) cover your usage — worth a quick legal check rather than a
blocker.]

## 9. Children's privacy

[NEEDS REVIEW: the app currently has no age gate or minimum-age field
anywhere in the codebase or sign-up flow. Decide and state an actual
minimum age (commonly 13, sometimes 16 in the EU under GDPR Article 8
depending on member state) and, if you want to rely on that age
restriction as a compliance measure, consider whether any enforcement
(even just a checkbox at signup) should be added — right now nothing in
the product would prevent or detect underage sign-ups.]

## 10. Security

We rely on Supabase's infrastructure, including Row Level Security (RLS)
policies that restrict each user to their own data, and database-level
triggers that prevent even the app's own client code from directly
modifying billing/subscription status or usage-limit fields — those can
only be changed by our backend (via Paddle's webhook or a dedicated
server-side function), not by any client request. [NEEDS REVIEW: add any
further security practices you want disclosed, e.g. encryption at rest
(Supabase default), incident response process, etc.]

## 11. Changes to this policy

We'll update this page if what we collect or how we use it changes, and
update the "Last updated" date above. [NEEDS REVIEW: decide whether you
want to commit to a specific notice mechanism for material changes, e.g.
email or in-app notice, particularly relevant under POPIA/GDPR for changes
affecting the legal basis of processing.]

## 12. Contact us

Questions, requests to access/correct/delete your data, or complaints:

**Seedstack Studio (Pty) Ltd**
Email: seedstackstudio@gmail.com

If you're in the EU/UK and unsatisfied with our response, you have the
right to lodge a complaint with your local data protection authority. If
you're in South Africa, you may contact the **Information Regulator**
(South Africa). [NEEDS REVIEW: consider adding the Information Regulator's
current contact details/URL directly.]
