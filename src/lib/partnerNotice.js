// Dismissal of the partner panel's "declined" / "ended" notice.
//
// Deliberately its own module with no Supabase import. It started life in
// accountabilityService.js, which looked like the natural home -- until the
// test could not even load it: that module imports supabaseClient, which
// calls createClient at module scope and throws "supabaseUrl is required"
// without env vars. Client-local UI state has no reason to be coupled to
// the RPC layer, and the inability to test it in isolation was that
// coupling showing up as a symptom.
//
// Client-local rather than a column on accountability_partnerships, which
// is the other obvious option: that table has no direct insert/update
// policy at all by design -- status IS the state machine and every
// transition goes through a guarded RPC. A per-device "I have seen this" is
// not worth widening that surface for.
//
// Reads and writes go through try/catch so a private window or blocked site
// data degrades to "not dismissed" rather than throwing during render,
// which is the only place the read is called from.
//
// Only one id is stored, because only one notice is ever shown -- the newest
// terminal partnership. Anything older has already been superseded, and
// storing the id rather than a boolean is what makes a NEW partnership
// ending produce a fresh notice.
const PARTNER_NOTICE_KEY = "accountabilityPartnerNoticeDismissed";

export function isPartnerNoticeDismissed(partnershipId) {
  if (!partnershipId) return false;
  try {
    return localStorage.getItem(PARTNER_NOTICE_KEY) === partnershipId;
  } catch {
    return false;
  }
}

export function dismissPartnerNotice(partnershipId) {
  if (!partnershipId) return;
  try {
    localStorage.setItem(PARTNER_NOTICE_KEY, partnershipId);
  } catch {
    // A viewer who cannot persist the dismissal sees the notice again next
    // visit. Mildly annoying, and strictly better than a crash.
  }
}

// ---------------------------------------------------------------------
// Dismissal of the one-time "you are already sharing these" notice.
//
// 20261024090001 backfilled every existing active partnership with the
// habits that partnership could already see. That was the right call --
// starting empty would have blanked live partnerships until each side
// happened to open the app and pick, which reads as a partner having
// abandoned every habit they had. But it means two people are now
// sharing a set neither of them explicitly chose, so they are told once,
// with a way straight to the picker.
//
// Keyed by partnership id for the same reason as above: a NEW partnership
// collects its scope through the consent screen and must never show this
// notice, while the backfilled one shows it exactly once per device.
const SCOPE_NOTICE_KEY = "accountabilityScopeNoticeDismissed";

export function isScopeNoticeDismissed(partnershipId) {
  if (!partnershipId) return false;
  try {
    return localStorage.getItem(SCOPE_NOTICE_KEY) === partnershipId;
  } catch {
    return false;
  }
}

export function dismissScopeNotice(partnershipId) {
  if (!partnershipId) return;
  try {
    localStorage.setItem(SCOPE_NOTICE_KEY, partnershipId);
  } catch {
    // Same trade as above: seen again next visit rather than a crash.
  }
}
