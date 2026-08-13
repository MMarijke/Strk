import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Copy, Share2, Check } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";
import { toast } from "sonner";

function generateInviteCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function getInviteLink(code) {
  return `${window.location.origin}?join=${code}`;
}

export default function CreateGroupModal({ open, onOpenChange, onCreate, userEmail, groupCount = 0, onUpgrade }) {
  const { isPro } = useSubscription();
  const paywalled = groupCount >= 2 && !isPro;
  const [step, setStep] = useState("form"); // "form" | "invite"
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [createdGroup, setCreatedGroup] = useState(null);
  const [copied, setCopied] = useState(null);
  const [loading, setLoading] = useState(false);

  // Free plan is capped at 2 groups — redirect straight to the upgrade flow
  // instead of showing the create-group form.
  useEffect(() => {
    if (open && paywalled) {
      onOpenChange(false);
      onUpgrade?.();
    }
  }, [open, paywalled]);

  const handleCreate = async () => {
    if (loading) return;
    setLoading(true);
    const code = generateInviteCode();
    const groupData = {
      name: name.trim(),
      description: description.trim(),
      is_private: isPrivate,
      invite_code: code,
      member_emails: [userEmail],
    };

    try {
      const savedGroup = await onCreate(groupData);
      if (savedGroup && savedGroup.invite_code) {
        setCreatedGroup(savedGroup);
      } else {
        setCreatedGroup({ ...groupData, invite_code: code });
      }
      setStep("invite");
    } catch (error) {
      console.error("Failed to create group:", error);
      toast.error("Couldn't create that group. Please try again.", { duration: 3000 });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text, type) => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleClose = () => {
    setStep("form");
    setName("");
    setDescription("");
    setIsPrivate(true);
    setCreatedGroup(null);
    setLoading(false);
    onOpenChange(false);
  };

  const inviteLink = createdGroup ? getInviteLink(createdGroup.invite_code) : "";

  return (
    <Dialog open={open && !paywalled} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm w-[calc(100%-2rem)] mx-auto overflow-y-auto max-h-[90vh]">
        {step === "form" ? (
          <>
            <DialogHeader>
              <DialogTitle>Create a Group</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <Label htmlFor="gname">Group name</Label>
                <Input
                  id="gname"
                  placeholder="e.g. Morning Warriors"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gdesc">Description (optional)</Label>
                <Input
                  id="gdesc"
                  placeholder="What's this group about?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between py-2 border-t border-border">
                <div>
                  <p className="text-sm font-medium">Private group</p>
                  <p className="text-xs text-muted-foreground">Only joinable via invite link</p>
                </div>
                <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
              </div>
              <Button className="w-full" disabled={!name.trim() || loading} onClick={handleCreate}>
                {loading ? "Creating…" : "Create Group"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Invite your friends 🎉</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{createdGroup?.name}</span> is ready! Share the code or link below.
              </p>

              <div className="space-y-1.5">
                <Label>Invite Code</Label>
                <div className="flex gap-2">
                  <div className="flex-1 bg-muted rounded-lg px-3 py-2 font-mono text-lg font-bold tracking-widest text-center text-foreground">
                    {createdGroup?.invite_code}
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => handleCopy(createdGroup?.invite_code, "code")}
                  >
                    {copied === "code" ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Invite Link</Label>
                <div className="flex gap-2">
                  <div className="flex-1 bg-muted rounded-lg px-3 py-2 text-xs text-muted-foreground truncate">
                    {inviteLink}
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => handleCopy(inviteLink, "link")}
                  >
                    {copied === "link" ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
                  </Button>
                  {navigator.share && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => navigator.share({ title: createdGroup?.name, url: inviteLink })}
                    >
                      <Share2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>

              <Button className="w-full" onClick={handleClose}>Done</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}