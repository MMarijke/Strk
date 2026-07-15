import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, RefreshCw, UserMinus, Settings, Info } from "lucide-react";
import { format, parseISO } from "date-fns";
import { getDisplayName } from "@/lib/displayName";
import { cn } from "@/lib/utils";

function generateInviteCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export default function GroupSettingsModal({
  open,
  onOpenChange,
  group,
  isAdmin,
  userEmail,
  profiles,
  activeChallenge,
  onUpdate,
  onDelete,
  onRemoveMember,
}) {
  const [newName, setNewName] = useState(group.name);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null); // email
  const [deleteInput, setDeleteInput] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const memberEmails = group.member_emails || [];
  const otherMembers = memberEmails.filter((e) => e !== userEmail);

  const handleRename = () => {
    if (newName.trim() && newName.trim() !== group.name) {
      onUpdate({ name: newName.trim() });
    }
  };

  const handleRegenerate = () => {
    onUpdate({ invite_code: generateInviteCode() });
    setConfirmRegenerate(false);
  };

  const handleRemove = (email) => {
    onRemoveMember(email);
    setConfirmRemove(null);
  };

  const handleDelete = () => {
    if (deleteInput.trim() === group.name) {
      onDelete();
      onOpenChange(false);
    }
  };

  // Read-only view for non-admins
  if (!isAdmin) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="w-4 h-4 text-primary" /> Group Info
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-xl bg-muted/50 p-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Name</span>
                <span className="font-semibold">{group.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Members</span>
                <span className="font-semibold">{memberEmails.length}</span>
              </div>
              {group.created_date && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span className="font-semibold">{format(parseISO(group.created_date), "MMM d, yyyy")}</span>
                </div>
              )}
              {activeChallenge && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Active challenge</span>
                  <span className="font-semibold truncate max-w-[140px]">{activeChallenge.habit_name}</span>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Admin view
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-primary" /> Group Settings
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pb-2">
          {/* Rename */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Rename Group</Label>
            <div className="flex gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="flex-1"
                maxLength={60}
              />
              <Button
                onClick={handleRename}
                disabled={!newName.trim() || newName.trim() === group.name}
                size="sm"
                className="shrink-0"
              >
                Save
              </Button>
            </div>
          </div>

          {/* Regenerate invite link */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Invite Link</Label>
            <div className="rounded-xl bg-muted/50 px-3 py-2 text-xs font-mono text-muted-foreground truncate">
              {group.invite_code || "No invite code"}
            </div>
            {confirmRegenerate ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                <p className="text-xs text-destructive font-medium">
                  This will invalidate your current invite link. Are you sure?
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={handleRegenerate}>
                    Yes, regenerate
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConfirmRegenerate(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" size="sm" className="gap-2 w-full" onClick={() => setConfirmRegenerate(true)}>
                <RefreshCw className="w-3.5 h-3.5" /> Regenerate Invite Link
              </Button>
            )}
          </div>

          {/* Remove members */}
          {otherMembers.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Members</Label>
              <div className="space-y-1.5">
                {otherMembers.map((email) => {
                  const name = getDisplayName(email, profiles);
                  return (
                    <div key={email} className="rounded-xl bg-muted/50 p-3">
                      {confirmRemove === email ? (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-destructive">
                            Remove {name} from the group?
                          </p>
                          <div className="flex gap-2">
                            <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => handleRemove(email)}>
                              Remove
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConfirmRemove(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                              {name[0].toUpperCase()}
                            </div>
                            <span className="text-sm font-medium truncate">{name}</span>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                            onClick={() => setConfirmRemove(email)}
                          >
                            <UserMinus className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Delete group */}
          <div className="space-y-2 pt-2 border-t border-border">
            <Label className="text-sm font-semibold text-destructive">Danger Zone</Label>
            {showDeleteConfirm ? (
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-3">
                <p className="text-xs text-destructive font-medium leading-relaxed">
                  This will permanently delete the group and all its data. Type the group name to confirm.
                </p>
                <Input
                  placeholder={group.name}
                  value={deleteInput}
                  onChange={(e) => setDeleteInput(e.target.value)}
                  className="border-destructive/40 text-sm"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-8 text-xs gap-1"
                    disabled={deleteInput.trim() !== group.name}
                    onClick={handleDelete}
                  >
                    <Trash2 className="w-3 h-3" /> Delete Group
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs"
                    onClick={() => { setShowDeleteConfirm(false); setDeleteInput(""); }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete Group
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}