import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Handshake } from "lucide-react";
import { cn } from "@/lib/utils";
import { getDisplayName } from "@/lib/displayName";

export default function InvitePartnerModal({ open, onOpenChange, groupmateEmails = [], profiles = [], onInvite }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  const handleClose = () => {
    setEmail("");
    setError("");
    onOpenChange(false);
  };

  const handleSend = async () => {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setSending(true);
    setError("");
    try {
      await onInvite(trimmed);
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
            <Handshake className="w-4 h-4 text-primary" />
            Invite an Accountability Partner
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {groupmateEmails.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">From one of your groups</Label>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {groupmateEmails.map((gEmail) => (
                  <button
                    key={gEmail}
                    onClick={() => { setEmail(gEmail); setError(""); }}
                    className={cn(
                      "w-full flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-left transition-all",
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
            <Label className="text-xs font-medium">
              {groupmateEmails.length > 0 ? "Or enter their email" : "Their email"}
            </Label>
            <Input
              type="email"
              placeholder="friend@example.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <Button className="w-full gap-2" onClick={handleSend} disabled={!email.trim() || sending}>
            <Handshake className="w-4 h-4" />
            {sending ? "Sending…" : "Send Invite"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
