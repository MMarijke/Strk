import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/api/supabaseClient";

export default function JoinFocusModal({ open, onOpenChange, userEmail, onSessionJoined }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Set when join_focus_session reports the session is already 'active' --
  // requirement 5: don't silently join with a different remaining time
  // than everyone else, ask first.
  const [inProgressConfirm, setInProgressConfirm] = useState(false);

  const callJoin = (confirmActive) =>
    supabase.rpc("join_focus_session", {
      p_session_code: code.trim().toUpperCase(),
      p_confirm_active: confirmActive,
    });

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

    const { data, error: rpcError } = await callJoin(false);

    if (rpcError) {
      setLoading(false);
      if (rpcError.message?.includes("SESSION_IN_PROGRESS")) {
        setInProgressConfirm(true);
        return;
      }
      setError("Session not found or already ended");
      return;
    }

    onOpenChange(false);
    onSessionJoined(data);
    reset();
  };

  const handleJoinAnyway = async () => {
    setLoading(true);
    const { data, error: rpcError } = await callJoin(true);
    setLoading(false);
    if (rpcError) { setError("Failed to join session"); return; }
    onOpenChange(false);
    onSessionJoined(data);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) reset(); }}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Join Focus Session</DialogTitle>
        </DialogHeader>

        {inProgressConfirm ? (
          <div className="space-y-4 pt-1">
            <p className="text-sm text-muted-foreground">
              This session is already in progress — you'll join with less time remaining than
              everyone else. Join anyway?
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-xl h-11" onClick={reset}>
                Cancel
              </Button>
              <Button className="flex-1 rounded-xl h-11 font-semibold" onClick={handleJoinAnyway} disabled={loading}>
                {loading ? "Joining…" : "Join Anyway"}
              </Button>
            </div>
          </div>
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
