import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

const QUICK_REACTIONS = [
  { emoji: "🔥", label: "fire" },
  { emoji: "💪", label: "strength" },
  { emoji: "👀", label: "eyes" },
  { emoji: "⚡", label: "lightning" },
  { emoji: "🫶", label: "heart hands" },
];
// Exported so the surfaces that tell a user how many they have left read
// the same number this component enforces against. send_reaction
// (20260811090005) is the real authority -- this is for display only -- but
// three hardcoded 3s drifting apart is how a screen ends up promising an
// allowance the server disagrees with.
export const DAILY_LIMIT = 3;

export default function ReactionButton({ recipientEmail, groupId, onSend, sentTodayCount = 0, isPro = false }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(null);
  const ref = useRef(null);
  const limited = !isPro && sentTodayCount >= DAILY_LIMIT;
  const remaining = Math.max(DAILY_LIMIT - sentTodayCount, 0);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleReact = async (emoji) => {
    if (limited) return;
    setOpen(false);
    try {
      // Wait for the write to actually land before showing "sent" -- this
      // used to fire setSent() optimistically and unconditionally, so a
      // failed insert (e.g. the recipient_name column-mismatch bug) still
      // looked successful to the sender with no indication anything was
      // wrong. The failure toast itself is handled by the mutation's
      // onError in the parent; catch here just prevents the false "sent"
      // confirmation from showing.
      // sender_email/sender_name are no longer sent -- send_reaction derives
      // both server-side (caller's own JWT email, user_profiles.display_name).
      await onSend({
        recipient_email: recipientEmail,
        group_id: groupId,
        emoji,
      });
      setSent(emoji);
      setTimeout(() => setSent(null), 2000);
    } catch {
      // onError toast already surfaces this; nothing else to do here.
    }
  };

  return (
    <div className="relative shrink-0" ref={ref}>
      {/* The comment that used to sit here claimed `p-2 -m-2` grew the hit
          area to 44px ("28px visual + 2*8px"). It did not. Tailwind
          preflight sets `box-sizing: border-box` and nothing in this
          project overrides it (no box-sizing, corePlugins or preflight
          key in index.css, tailwind.config.js or postcss.config.js), so
          with `w-7 h-7` the 28px IS the whole box and the padding lives
          inside it. The negative margin then shrank the layout footprint
          rather than enlarging the target. Real hit area: 28x28.

          It also cited HabitCard's reminder-bell as precedent. That one is
          genuinely fine, and the difference is exactly the part that
          matters: it sets `p-4 -m-4` with NO width or height, so the
          padding really does expand an auto-sized box. The trick works
          until you combine it with an explicit size -- which is the one
          thing that made this instance look safe while silently failing.

          Sized honestly now. The glyph stays small; the box is 44px, the
          same as every other control in this row. */}
      <button
        onClick={() => !limited && setOpen((v) => !v)}
        title={
          isPro
            ? "Send reaction"
            : limited
              ? "3/3 used today. Upgrade to Pro for unlimited."
              : `Send reaction (${remaining} left today)`
        }
        aria-label={
          isPro
            ? "Send reaction"
            : limited
              ? "Send reaction, daily limit reached. Upgrade to Pro for unlimited."
              : `Send reaction, ${remaining} left today`
        }
        aria-expanded={open}
        className={cn(
          "h-11 w-11 rounded-full flex items-center justify-center text-base transition-all",
          limited
            ? "opacity-30 cursor-not-allowed"
            : "hover:bg-muted hover:scale-110 active:scale-95"
        )}
      >
        {sent
          ? <span className="text-sm" aria-hidden="true">{sent}</span>
          : <span className="text-[14px] leading-none" aria-hidden="true">😊</span>
        }
      </button>

      {/* Picker */}
      {open && (
        <div className="absolute right-0 bottom-full mb-1 z-50 flex gap-0.5 bg-card border border-border rounded-2xl shadow-lg px-2 py-1.5">
          {QUICK_REACTIONS.map(({ emoji, label }) => (
            <button
              key={emoji}
              onClick={() => handleReact(emoji)}
              aria-label={`React with ${label}`}
              // Same correction as the trigger: `w-8 h-8 p-1.5 -m-1.5`
              // was a 32x32 hit area, not the 44px its comment claimed.
              // Five 44px targets plus gaps come to ~244px inside a
              // right-aligned popover, which still clears the 272px a
              // 320px viewport leaves after the page gutter.
              className="h-11 w-11 flex items-center justify-center text-xl hover:scale-125 active:scale-90 transition-transform rounded-xl hover:bg-muted"
            >
              <span aria-hidden="true">{emoji}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}