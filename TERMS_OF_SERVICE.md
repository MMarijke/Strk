# Terms of Service — Strk

**Effective date:** [NEEDS REVIEW — insert the date these terms actually go live]
**Last updated:** 2026-07-30

These Terms of Service ("Terms") are a legal agreement between you and
**Seedstack Studio (Pty) Ltd** ("Seedstack Studio," "we," "us," "our"), a
company registered in South Africa, governing your use of Strk (the
"Service," "App"). By creating an account or using Strk, you agree to
these Terms. If you don't agree, don't use the Service.

Our [Privacy Policy](./PRIVACY_POLICY.md) is incorporated into these Terms
by reference and explains what data we collect and why.

---

## 1. Eligibility

[NEEDS REVIEW: the app currently has no age-verification of any kind — no
age field, no age-gate at sign-up. Decide and state an actual minimum age
here (commonly 13, sometimes higher depending on jurisdiction — e.g. GDPR
Article 8 lets EU member states set their own threshold up to 16). Until
an actual check exists in the product, this clause is a representation you
require users to make, not something the app enforces today — worth
knowing before you rely on it.]

By using Strk, you represent that you meet the minimum age requirement
above and that you have the legal capacity to enter into these Terms.

## 2. Your account

You sign in via a magic link sent to your email (through Supabase Auth) —
there's no separate password to manage. You're responsible for keeping
access to that email account secure, and for all activity under your
account. Tell us immediately at seedstackstudio@gmail.com if you believe
your account has been compromised.

## 3. Acceptable use

You agree not to:

- Use Strk for any unlawful purpose, or in a way that violates any
  applicable local, national, or international law or regulation.
- Impersonate another person, or misrepresent your affiliation with a
  person or entity.
- Harass, abuse, or send unwanted contact to other users through the
  group, reaction, or focus-session features.
- Attempt to gain unauthorized access to other users' accounts, data, or
  to Strk's systems (including probing, scanning, or bypassing rate
  limits, RLS policies, or subscription/usage-limit checks).
- Use automated means (bots, scrapers) to access the Service outside of
  any API we may officially publish.
- Upload or share content through Strk (habit names, group names/
  descriptions, challenge descriptions) that is unlawful, defamatory,
  hateful, sexually explicit, or infringes someone else's rights.
- Reverse-engineer, decompile, or attempt to extract the source code of
  the Service, except to the extent applicable law expressly permits it.

We currently review reports of misuse manually (there's no in-app
"report" or "block" button yet — see §7 for how content violations are
handled in the meantime). [NEEDS REVIEW: if you plan to add in-app
reporting/blocking, this section should be updated to describe that
mechanism once built.]

## 4. Subscriptions & billing

Strk offers a free plan and a paid **Pro** plan, billed monthly or
annually.

- **Merchant of Record:** All payments are processed by **Paddle.com
  Market Limited ("Paddle")**, who acts as the Merchant of Record for
  your purchase. This means Paddle — not Seedstack Studio — is the
  seller of record on your receipt/invoice, handles your payment method
  and card data directly, and is responsible for calculating and
  remitting applicable sales tax/VAT. Your purchase is also subject to
  [Paddle's Buyer Terms](https://www.paddle.com/legal/checkout-buyer-terms).
- **Plan changes:** Switching between monthly and annual billing takes
  effect immediately, and you're charged or credited a prorated amount
  for the remainder of your current billing period.
- **Cancellation:** You can cancel your Pro subscription at any time from
  the Manage Subscription page. Cancelling does not immediately revoke
  access — you keep Pro features until the end of your current, already-
  paid-for billing period, and your plan then moves to Free. There is no
  partial-period refund for cancelling mid-cycle.
- **Refunds:** [NEEDS REVIEW: no refund policy or logic currently exists
  in the app or backend. Decide whether you want to state a specific
  refund policy here (e.g. "no refunds except as required by law" or a
  goodwill window), or defer entirely to Paddle's own refund process as
  Merchant of Record — either is common, but it should be a deliberate
  choice, not a gap.]
- **Price changes:** We may change subscription pricing; we'll give you
  reasonable advance notice before a price change affects your next
  renewal. [NEEDS REVIEW: define "reasonable notice" concretely, e.g. 30
  days, if you want this enforceable rather than vague.]
- **Free plan limits:** Free accounts are limited to a set number of
  streak freezes per month and a limited group/analytics allowance; Pro
  removes these limits (unlimited groups, unlimited streak freezes, full
  historical analytics). We may change what's included in each plan
  going forward, with notice.

## 5. User-generated content

**What you create:** Strk lets you create habit names, group names and
descriptions, challenge descriptions, and send preset emoji reactions to
other group members. (Focus sessions themselves don't include free-text
notes — they're just scheduled time blocks with participants.)

- **You own it.** You retain ownership of the content you create.
- **The license you give us:** By posting content visible to other users
  (e.g. a group name/description, a challenge description, your display
  name), you grant Seedstack Studio a non-exclusive, worldwide,
  royalty-free license to host, store, display, and transmit that content
  as necessary to operate the Service — for example, showing your group's
  name to its members, or your display name on a shared leaderboard.
- **Visibility:** Group content is visible to that group's members.
  Public leaderboard visibility is controlled by your own `is_public`
  profile setting; private groups are invite-only via an invite code.
- **Content we can remove:** We may remove content that violates §3
  (Acceptable use) if we become aware of it. [NEEDS REVIEW: as noted in
  §3, there's currently no in-app reporting tool, so this is presently an
  ad hoc/manual process — reachable via seedstackstudio@gmail.com — worth
  flagging to counsel as an operational gap rather than a legal one.]

## 6. Our intellectual property

Strk's name, logo, branding, and the app's underlying software are owned
by Seedstack Studio (or our licensors) and are not covered by the content
license in §5. These Terms don't grant you any right to use our
trademarks or branding beyond what's needed to use the Service normally.

## 7. Termination

- **By you:** You can stop using Strk at any time, and can delete your
  account from Settings. Please note our Privacy Policy describes exactly
  what "Delete Account" currently removes — as of this writing, some
  account-linked data (group memberships, focus session history, earned
  badges, streak-freeze history) is not yet automatically removed by that
  action, and full erasure may currently require contacting us directly.
  [NEEDS REVIEW: keep this in sync with the Privacy Policy §7 fix if/when
  the deletion flow is updated to remove the underlying auth account.]
- **By us:** We may suspend or terminate your access to Strk if we
  reasonably believe you've violated these Terms, misused the Service, or
  if required by law. [NEEDS REVIEW: there's currently no admin
  suspend/ban tooling built in the app — enforcement today would be a
  manual, ad hoc process (e.g. directly via the database) rather than a
  built-in feature. This clause reserves the legal right regardless of
  current tooling, which is normal, but worth knowing operationally.]
- Sections that by their nature should survive termination (ownership,
  disclaimers, liability limits, dispute resolution) continue to apply
  after your account ends.

## 8. Disclaimers

Strk is provided "as is" and "as available," without warranties of any
kind, express or implied, including implied warranties of merchantability,
fitness for a particular purpose, and non-infringement. We don't guarantee
the Service will be uninterrupted, error-free, or that any habit-tracking
data will never be lost — though we take reasonable steps to protect it
(see our Privacy Policy §10 on security).

[NEEDS REVIEW: if you're targeting South African consumers directly, the
Consumer Protection Act (CPA) implies certain warranties/rights that
cannot be excluded by contract for qualifying consumer transactions —
have counsel confirm this disclaimer doesn't overreach against CPA-covered
users, and similarly check whether any equivalent mandatory consumer
warranty regimes apply in other countries you serve.]

## 9. Limitation of liability

To the maximum extent permitted by law, Seedstack Studio and its
officers, employees, and affiliates won't be liable for any indirect,
incidental, special, consequential, or punitive damages, or any loss of
data, profits, or goodwill, arising from your use of (or inability to
use) Strk — even if we've been advised of the possibility of such
damages.

[NEEDS REVIEW — this needs a concrete liability cap decided with counsel.
A common approach is capping total liability at the greater of (a) a
fixed small amount (e.g. R500/$50) or (b) the amount you paid us in the
12 months before the claim. As Merchant of Record, Paddle — not Seedstack
Studio — is the counterparty for payment-processing disputes, which
should be reflected here too. Also confirm this limitation is enforceable
against consumers in every jurisdiction you serve — some, including parts
of the EU, restrict how far liability can be limited against consumers
regardless of what a contract says.]

## 10. Indemnification

[NEEDS REVIEW: a mutual or one-way indemnification clause (you indemnify
us against claims arising from your misuse of the Service or content you
post) is standard in SaaS/app ToS but should be drafted with counsel —
not included here in placeholder form to avoid an unreviewed one-sided
clause going live.]

## 11. Governing law & dispute resolution

[NEEDS REVIEW — this is the section most in need of a lawyer's input
given a South African operating company serving a global user base:]

- **Governing law:** these Terms are governed by the laws of South
  Africa, without regard to conflict-of-law principles — [NEEDS REVIEW:
  confirm this is actually the choice you want, and that it's enforceable
  against users in jurisdictions with mandatory consumer-protection
  choice-of-law rules, e.g. many EU member states and some US states
  restrict enforcing a foreign choice-of-law/forum clause against their
  own consumers].
- **Dispute resolution / forum:** [NEEDS REVIEW: decide whether disputes
  go to South African courts, a specific arbitration body (and where —
  e.g. AFSA locally, or an international body like the ICC/JAMS for
  cross-border users), and whether you want a class-action waiver. This
  is a genuine strategic legal decision, not something to default without
  advice, especially with users potentially in the EU/UK/US.]
- Nothing here limits either party's right to seek injunctive relief in
  court for intellectual property infringement or unauthorized access to
  the Service.

## 12. Third-party services

Strk relies on third-party services to operate — Supabase (database,
auth, backend functions), Paddle (payments, as described in §4), PostHog
(product analytics), Resend (transactional email), and Vercel (hosting).
Your use of Strk is also subject to those providers' own terms where you
interact with them directly (most notably Paddle's Buyer Terms for any
purchase). See our Privacy Policy for details on what each processor
receives.

## 13. Changes to these Terms

We may update these Terms from time to time. If we make material changes,
we'll update the "Last updated" date above. [NEEDS REVIEW: decide whether
you want to commit to a specific advance-notice mechanism for material
changes — e.g. email notice — particularly if a change affects billing
terms or dispute resolution.]

## 14. Contact us

**Seedstack Studio (Pty) Ltd**
Email: seedstackstudio@gmail.com

---

*[NEEDS REVIEW — overall: this draft is grounded in what the Strk codebase
actually does today (billing behavior, content types, lack of moderation/
suspension tooling, lack of an age gate), but sections 8–11 in particular
(disclaimers, liability, indemnification, governing law/dispute
resolution) involve real legal judgment calls that should go through a
lawyer — especially given a South African entity serving a global,
multi-jurisdiction user base via app stores. Treat this as a strong,
accurate first draft, not a final, counsel-reviewed document.]*
