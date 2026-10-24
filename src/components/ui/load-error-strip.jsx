// An inline error for a failed fetch inside an otherwise-usable card.
//
// Lived as a private helper in GroupDashboard.jsx, where its own comment
// said it existed "so a load failure looks the same wherever it happens in
// this feature rather than inventing a second error language one folder
// over." The accountability panel needed exactly this, one folder over --
// so rather than prove that comment wrong by copying it, it moves here.
//
// text-destructive-text, not text-destructive: this is body-size text, and
// src/index.css documents the split (--destructive measures 3.90:1 against
// --background, under the AA floor; --destructive-text clears it at 5.81:1).
//
// The Retry target is h-11 so it meets the project's 44px standard even
// though it renders as a text link.
export default function LoadErrorStrip({ message, onRetry }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive-text text-xs">
      <span>{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="font-semibold underline underline-offset-2 shrink-0 h-11 px-1"
      >
        Retry
      </button>
    </div>
  );
}
