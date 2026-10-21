import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, RefreshCw, UserMinus, Settings, Info } from "lucide-react";
import { format, parseISO } from "date-fns";
import { getDisplayName } from "@/lib/displayName";
import { toast } from "sonner";

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
  const [renaming, setRenaming] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [removingEmail, setRemovingEmail] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const memberEmails = group.member_emails || [];
  const otherMembers = memberEmails.filter((e) => e !== userEmail);

  const handleRename = async () => {
    if (!newName.trim() || newName.trim() === group.name || renaming) return;
    setRenaming(true);
    try {
      await onUpdate({ name: newName.trim() });
    } catch (error) {
      console.error("Failed to rename group:", error);
      toast.error("Couldn't rename the group. Please try again.", { duration: 3000 });
    } finally {
      setRenaming(false);
    }
  };

  const handleRegenerate = async () => {
    if (regenerating) return;
    setRegenerating(true);
    try {
      await onUpdate({ invite_code: generateInviteCode() });
      setConfirmRegenerate(false);
    } catch (error) {
      console.error("Failed to regenerate invite link:", error);
      toast.error("Couldn't regenerate the invite link. Please try again.", { duration: 3000 });
    } finally {
      setRegenerating(false);
    }
  };

  const handleRemove = async (email) => {
    if (removingEmail) return;
    setRemovingEmail(email);
    try {
      await onRemoveMember(email);
      setConfirmRemove(null);
    } catch (error) {
      console.error("Failed to remove member:", error);
      toast.error("Couldn't remove that member. Please try again.", { duration: 3000 });
    } finally {
      setRemovingEmail(null);
    }
  };

  const handleDelete = async () => {
    if (deleteInput.trim() !== group.name || deleting) return;
    setDeleting(true);
    try {
      await onDelete();
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to delete group:", error);
      toast.error("Couldn't delete the group. Please try again.", { duration: 3000 });
    } finally {
      setDeleting(false);
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
                disabled={!newName.trim() || newName.trim() === group.name || renaming}
                size="sm"
                className="shrink-0"
              >
                {renaming ? "Saving…" : "Save"}
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
                  <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={handleRegenerate} disabled={regenerating}>
                    {regenerating ? "Regenerating…" : "Yes, regenerate"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConfirmRegenerate(false)} disabled={regenerating}>
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
                          <p className="text-xs font-medium text-destructive-text">
                            Remove {name} from the group?
                          </p>
                          <div className="flex gap-2">
                            {/* h-11 without w-11: both carry text labels,
                                so a fixed 44px width would clamp them.
                                Height was the failing axis -- at h-7 these
                                were 28px, and this is now the only route
                                to an irreversible action, so they have to
                                be properly tappable. */}
                            <Button size="sm" variant="destructive" className="h-11 text-xs" onClick={() => handleRemove(email)} disabled={removingEmail === email}>
                              {removingEmail === email ? "Removing…" : "Remove"}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-11 text-xs" onClick={() => setConfirmRemove(null)} disabled={removingEmail === email}>
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
                            className="h-11 w-11 text-muted-foreground hover:text-destructive shrink-0"
                            onClick={() => setConfirmRemove(email)}
                            aria-label={`Remove ${name} from group`}
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
                    disabled={deleteInput.trim() !== group.name || deleting}
                    onClick={handleDelete}
                  >
                    <Trash2 className="w-3 h-3" /> {deleting ? "Deleting…" : "Delete Group"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs"
                    onClick={() => { setShowDeleteConfirm(false); setDeleteInput(""); }}
                    disabled={deleting}
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