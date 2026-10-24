/**
 * Shapes get_partner_dashboard's flat rows into the two columns the
 * partner panel renders.
 *
 * The RPC returns one row per shared habit per side, plus -- because it
 * left-joins the share scope -- exactly one row with a null habit_id for a
 * side that shares nothing. That null-habit row is load-bearing: it is how
 * the client learns a partner's name and colour when they have shared
 * nothing, and it is why zero rows overall still means "the partnership is
 * gone" rather than "nobody shares anything".
 *
 * Kept out of the component, and out of accountabilityService.js, for the
 * reason partnerNotice.js exists: that service imports supabaseClient,
 * which calls createClient at module scope and throws without env vars, so
 * anything living there cannot be unit-tested in isolation.
 */

/** A side with no rows at all -- distinct from a side that shares nothing. */
const EMPTY_SIDE = null;

function buildSide(rows) {
  if (!rows.length) return EMPTY_SIDE;
  const [first] = rows;
  // Only rows with a real habit_id are habits; the null-habit row carries
  // identity alone and must not become a nameless entry in the list.
  const habits = rows
    .filter((r) => r.habit_id)
    .map((r) => ({
      id: r.habit_id,
      name: r.habit_name,
      streak: r.current_streak ?? 0,
      completedToday: !!r.completed_today,
    }));
  return {
    email: first.user_email,
    name: first.display_name,
    avatarColor: first.avatar_color,
    habits,
    doneToday: habits.filter((h) => h.completedToday).length,
    total: habits.length,
  };
}

/**
 * @returns null when there is no active partnership (zero rows), otherwise
 * { partnershipId, you, partner }, either of which may itself be null if
 * the RPC somehow returned only one side.
 */
export function groupPartnerColumns(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const you = buildSide(rows.filter((r) => r.side === "you"));
  const partner = buildSide(rows.filter((r) => r.side === "partner"));
  return {
    partnershipId: rows[0].partnership_id,
    you,
    partner,
  };
}

/**
 * The one-line comparison for the summary row: "2 of 3" / "all 3" / "none
 * yet". Separate from the component because the wording is the part worth
 * testing, and because "0 of 0" must never render as a score -- a side
 * that shares nothing has not failed at anything.
 */
export function describeToday(side) {
  if (!side || side.total === 0) return "Nothing shared";
  if (side.doneToday === 0) return `None of ${side.total} today`;
  if (side.doneToday === side.total) {
    return side.total === 1 ? "Done today" : `All ${side.total} today`;
  }
  return `${side.doneToday} of ${side.total} today`;
}
