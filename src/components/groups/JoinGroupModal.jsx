import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/api/supabaseClient";

function extractCode(input) {
  // Accept raw code or URL with ?join=CODE
  const trimmed = input.trim().toUpperCase();
  const urlMatch = trimmed.match(/[?&]JOIN=([A-Z0-9]{8})/);
  if (urlMatch) return urlMatch[1];
  if (/^[A-Z0-9]{8}$/.test(trimmed)) return trimmed;
  return null;
}

export default function JoinGroupModal({ open, onOpenChange, onJoin }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);

  const handleJoin = async () => {
    setError("");
    const code = extractCode(input);
    if (!code) {
      setError("Please enter a valid 8-character invite code or link.");
      return;
    }
    setJoining(true);
    // join_group does the lookup itself (SECURITY DEFINER, bypasses the
    // member-only groups_select RLS) and adds the caller in one write --
    // there's no RLS-visible way to preview the group before joining, since
    // a non-member can't SELECT it at all.
    const { data, error: rpcError } = await supabase.rpc("join_group", { p_invite_code: code });
    setJoining(false);
    if (rpcError) {
      setError("No group found with that code.");
      return;
    }
    onJoin(data);
    handleClose();
  };

  const handleClose = () => {
    setInput("");
    setError("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Join a Group</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Invite code or link</Label>
            <Input
              placeholder="e.g. ABC12345"
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <Button className="w-full" onClick={handleJoin} disabled={!input.trim() || joining}>
            {joining ? "Joining…" : "Join Group"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
