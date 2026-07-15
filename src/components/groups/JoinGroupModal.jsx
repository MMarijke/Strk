import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Users } from "lucide-react";
import { Group } from "@/api/entities";

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
  const [foundGroup, setFoundGroup] = useState(null);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);

  const handleLookup = async () => {
    setError("");
    setFoundGroup(null);
    const code = extractCode(input);
    if (!code) {
      setError("Please enter a valid 8-character invite code or link.");
      return;
    }
    setSearching(true);
    const results = await Group.filter({ invite_code: code });
    setSearching(false);
    if (!results || results.length === 0) {
      setError("No group found with that code.");
      return;
    }
    setFoundGroup(results[0]);
  };

  const handleJoin = () => {
    if (foundGroup) {
      onJoin(foundGroup);
      handleClose();
    }
  };

  const handleClose = () => {
    setInput("");
    setFoundGroup(null);
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
            <div className="flex gap-2">
              <Input
                placeholder="e.g. ABC12345"
                value={input}
                onChange={(e) => { setInput(e.target.value); setFoundGroup(null); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleLookup()}
              />
              <Button variant="outline" onClick={handleLookup} disabled={!input.trim() || searching}>
                {searching ? "..." : "Find"}
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          {foundGroup && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Users className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm">{foundGroup.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(foundGroup.member_emails || []).length} member{(foundGroup.member_emails || []).length !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>
              {foundGroup.description && (
                <p className="text-xs text-muted-foreground">{foundGroup.description}</p>
              )}
              <Button className="w-full" onClick={handleJoin}>Join Group</Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}