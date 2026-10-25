import React, { useState } from "react";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Handshake } from "lucide-react";
import { cn } from "@/lib/utils";
import { getDisplayName } from "@/lib/displayName";
import HabitSharePicker from "./HabitSharePicker";

// Not react-hook-form + zodResolver -- this is a single plain controlled
// input, and wiring up a form library for one field would be more
// restructuring than the validation itself warrants. z.string().email()
// still replaces the old `!trimmed.includes("@")` check with something
// that actually validates email shape instead of just checking for an "@".
const emailSchema = z.string().trim().min(1, "Enter their email.").email("Enter a valid email address.");

export default function InvitePartnerModal({ open, onOpenChange, userEmail, groupmateEmails = [], profiles = [], onInvite }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  // Nothing pre-selected. The invite carries an offer, and an offer the
  // sender did not actually make is not one.
  const [selected, setSelected] = useState([]);

  const handleClose = () => {
    setEmail("");
    setError("");
    setSelected([]);
    onOpenChange(false);
  };

  const handleSend = async () => {
    if (sending) return;
    const result = emailSchema.safeParse(email);
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    const trimmed = result.data;
    setSending(true);
    setError("");
    try {
      await onInvite(trimmed, selected);
      handleClose();
    } catch (err) {
      setError(err.message || "Couldn't send that invite.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Handshake className="w-4 h-4 text-primary" aria-hidden="true" />
            Invite an Accountability Partner
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {groupmateEmails.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium" id="partner-groupmates-label">
                From one of your groups
              </Label>
              <div className="space-y-1.5 max-h-40 overflow-y-auto" role="group" aria-labelledby="partner-groupmates-label">
                {groupmateEmails.map((gEmail) => (
                  <button
                    key={gEmail}
                    type="button"
                    onClick={() => { setEmail(gEmail); setError(""); }}
                    aria-pressed={email === gEmail}
                    className={cn(
                      "w-full min-h-11 flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-left transition-all",
                      "outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      email === gEmail
                        ? "border-primary bg-primary/5"
                        : "border-transparent bg-muted hover:bg-muted/80"
                    )}
                  >
                    <span className="text-sm font-medium truncate">{getDisplayName(gEmail, profiles)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="partner-email" className="text-xs font-medium">
              {groupmateEmails.length > 0 ? "Or enter their email" : "Their email"}
            </Label>
            <Input
              id="partner-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={254}
              placeholder="friend@example.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "partner-email-error" : undefined}
            />
            {/* role="alert" because this is the only feedback for a failed
                invite, and it appears below a field the user has already
                left. text-destructive-text, not text-destructive, at
                body size -- see the note in src/index.css. */}
            {error && (
              <p id="partner-email-error" role="alert" className="text-xs text-destructive-text">
                {error}
              </p>
            )}
          </div>

          <div className="space-y-1.5 pt-1 border-t border-border">
            <Label className="text-xs font-medium pt-2 block" id="partner-share-label">
              What should they see?
            </Label>
            {/* Stated here rather than in a tooltip, because this is the
                only point at which the user can act on it. Before this
                change, accepting or sending an invite granted a standing
                read of every habit you had, disclosed nowhere. */}
            <p className="text-xs text-muted-foreground">
              Only the habits you pick, and only their name, streak and whether you checked in today. Never your past days. You can change this later.
            </p>
            <HabitSharePicker
              userEmail={userEmail}
              selected={selected}
              onChange={setSelected}
              disabled={sending}
              labelledBy="partner-share-label"
            />
          </div>

          {/* The label states what the button will do rather than a
              pre-ticked list deciding it. Sharing nothing stays possible
              and visible -- it is just not the default wording. */}
          <Button className="w-full gap-2 h-11" onClick={handleSend} disabled={!email.trim() || sending}>
            <Handshake className="w-4 h-4" aria-hidden="true" />
            {sending
              ? "Sending…"
              : selected.length > 0
                ? `Send invite · sharing ${selected.length}`
                : "Send invite without sharing"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
