import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { joinFocusSession } from "@/lib/focusSessionJoin";
import JoinInProgressConfirm from "./JoinInProgressConfirm";

export default function JoinFocusModal({ open, onOpenChange, userEmail, onSessionJoined }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Set when join_focus_session reports the session is already 'active' --
  // requirement 5: don't silently join with a different remaining time
  // than everyone else, ask first.
  const [inProgressConfirm, setInProgressConfirm] = useState(false);

  const reset = () => {
    setLoading(false);
    setError("");
    setInProgressConfirm(false);
    setCode("");
  };

  const handleJoin = async () => {
    if (code.trim().length < 6) { setError("Enter a 6-character code"); return; }
    setLoading(true);
    setError("");

    const result = await joinFocusSession(code);
    setLoading(false);

    if (!result.ok) {
      if (result.reason === "IN_PROGRESS") {
        setInProgressConfirm(true);
        return;
      }
      setError("Session not found or already ended");
      return;
    }

    onOpenChange(false);
    onSessionJoined(result.session);
    reset();
  };

  const handleJoinAnyway = async () => {
    setLoading(true);
    const result = await joinFocusSession(code, true);
    setLoading(false);
    if (!result.ok) { setError("Failed to join session"); return; }
    onOpenChange(false);
    onSessionJoined(result.session);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) reset(); }}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Join Focus Session</DialogTitle>
        </DialogHeader>

        {inProgressConfirm ? (
          <JoinInProgressConfirm onCancel={reset} onConfirm={handleJoinAnyway} loading={loading} />
        ) : (
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
        )}
      </DialogContent>
    </Dialog>
  );
}
