// Shared by StreakWidget.jsx and EditWeekDialog.jsx -- both render a day
// cell that can be "frozen" (a streak freeze was applied to cover a missed
// day), and previously duplicated the same hardcoded color and title
// independently. One source now, and it reacts to the --frozen token
// (index.css) instead of a literal hex that couldn't.
export const FROZEN_CELL_STYLE = { backgroundColor: "hsl(var(--frozen))" };
export const FROZEN_CELL_TITLE = "Streak freeze applied";
