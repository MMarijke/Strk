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
    setError("");
    const result = await joinFocusSession(code, true);
    setLoading(false);
    // This error used to be set and then never rendered: the only error
    // element lived in the other branch of the inProgressConfirm ternary
    // below, so while the confirm was showing there was nowhere on screen
    // for it to appear. The button finished its "Joining…" state and the
    // modal just sat there -- on precisely the flaky-connection path, right
    // after the user had deliberately accepted less time. It now renders
    // inside the confirm itself, so the failure lands in the same view that
    // produced it and the decision context is preserved.
    if (!result.ok) { setError("Couldn't join that session. Check your connection and try again."); return; }
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
          <JoinInProgressConfirm onCancel={reset} onConfirm={handleJoinAnyway} loading={loading} error={error} />
        ) : (
          <div className="space-y-4 pt-1">
            <Input
              placeholder="Enter 6-character code"
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(""); }}
              maxLength={6}
              className="font-mono text-center text-lg tracking-widest uppercase rounded-xl h-12"
            />
            {/* text-destructive-text, not text-destructive: src/index.css
                documents that --destructive measures 3.90:1 against
                --background, under the AA floor for body text, which is
                exactly why --destructive-text exists. role="alert" so a
                rejected code is announced rather than silently appearing. */}
            {error && <p className="text-xs text-destructive-text text-center" role="alert">{error}</p>}
            <Button className="w-full rounded-xl h-11 font-semibold" onClick={handleJoin} disabled={loading}>
              {loading ? "Joining…" : "Join Session"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
