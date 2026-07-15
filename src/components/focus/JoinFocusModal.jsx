import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FocusSession } from "@/api/entities";

export default function JoinFocusModal({ open, onOpenChange, userEmail, onSessionJoined }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleJoin = async () => {
    if (code.trim().length < 6) { setError("Enter a 6-character code"); return; }
    setLoading(true);
    setError("");
    const sessions = await FocusSession.filter({ session_code: code.trim().toUpperCase() });
    const session = sessions.find((s) => s.status === "active" || s.status === "waiting");
    if (!session) { setError("Session not found or already ended"); setLoading(false); return; }

    // Add user to participants if not already there
    if (!(session.participant_emails || []).includes(userEmail)) {
      const updated = await FocusSession.update(session.id, {
        participant_emails: [...(session.participant_emails || []), userEmail],
      });
      setLoading(false);
      onOpenChange(false);
      setCode("");
      onSessionJoined({ ...session, ...updated });
    } else {
      setLoading(false);
      onOpenChange(false);
      setCode("");
      onSessionJoined(session);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Join Focus Session</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <Input
            placeholder="Enter 6-character code"
            value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(""); }}
            maxLength={6}
            className="font-mono text-center text-lg tracking-widest uppercase rounded-xl h-12"
          />
          {error && <p className="text-xs text-destructive text-center">{error}</p>}
          <Button className="w-full rounded-xl h-11 font-semibold" onClick={handleJoin} disabled={loading}>
            {loading ? "Joining…" : "Join Session"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}