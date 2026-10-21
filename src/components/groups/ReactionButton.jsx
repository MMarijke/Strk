import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

const QUICK_REACTIONS = [
  { emoji: "🔥", label: "fire" },
  { emoji: "💪", label: "strength" },
  { emoji: "👀", label: "eyes" },
  { emoji: "⚡", label: "lightning" },
  { emoji: "🫶", label: "heart hands" },
];
const DAILY_LIMIT = 3;

// focusSessionId is the alternative authorisation context added in
// 20261021090002: a reaction carries either a group or a session, never
// both, and send_reaction checks whichever one it is given. Defaulted so
// GroupDashboard's existing group-only usage is unchanged.
export default function ReactionButton({ recipientEmail, groupId, focusSessionId = null, onSend, sentTodayCount = 0, isPro = false }) {
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
        focus_session_id: focusSessionId,
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
      {/* Trigger button -- p-2 -m-2 grows the real hit area to 44px (28px
          visual + 2*8px) without changing the button's visible footprint,
          same padding-trick pattern already used on HabitCard.jsx's
          reminder-bell button. */}
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
          "w-7 h-7 p-2 -m-2 rounded-full flex items-center justify-center text-base transition-all",
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
        <div className="absolute right-0 bottom-full mb-1 z-50 flex gap-1 bg-card border border-border rounded-2xl shadow-lg px-2 py-1.5">
          {QUICK_REACTIONS.map(({ emoji, label }) => (
            <button
              key={emoji}
              onClick={() => handleReact(emoji)}
              aria-label={`React with ${label}`}
              // Same padding-trick as the trigger above: 32px visual
              // (w-8 h-8) + 2*6px (p-1.5 -m-1.5) = 44px real hit area.
              className="w-8 h-8 p-1.5 -m-1.5 flex items-center justify-center text-xl hover:scale-125 active:scale-90 transition-transform rounded-xl hover:bg-muted"
            >
              <span aria-hidden="true">{emoji}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}