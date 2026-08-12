import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

const QUICK_REACTIONS = ["🔥", "💪", "👀", "⚡", "🫶"];
const DAILY_LIMIT = 3;

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
      {/* Trigger button */}
      <button
        onClick={() => !limited && setOpen((v) => !v)}
        title={
          isPro
            ? "Send reaction"
            : limited
              ? "3/3 used today. Upgrade to Pro for unlimited."
              : `Send reaction (${remaining} left today)`
        }
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center text-base transition-all",
          limited
            ? "opacity-30 cursor-not-allowed"
            : "hover:bg-muted hover:scale-110 active:scale-95"
        )}
      >
        {sent  
          ? <span className="text-sm">{sent}</span> 
          : <span className="text-[14px] leading-none">😊</span>
        }
      </button>

      {/* Picker */}
      {open && (
        <div className="absolute right-0 bottom-full mb-1 z-50 flex gap-1 bg-card border border-border rounded-2xl shadow-lg px-2 py-1.5">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => handleReact(emoji)}
              className="w-8 h-8 flex items-center justify-center text-xl hover:scale-125 active:scale-90 transition-transform rounded-xl hover:bg-muted"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}