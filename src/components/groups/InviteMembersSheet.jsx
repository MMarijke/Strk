import React, { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Copy, Check, Share2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

function getInviteLink(code) {
  return `${window.location.origin}?join=${code}`;
}

function truncateMiddle(str, maxLen = 40) {
  if (str.length <= maxLen) return str;
  const half = Math.floor((maxLen - 3) / 2);
  return str.slice(0, half) + "…" + str.slice(str.length - half);
}

export default function InviteMembersSheet({ open, onOpenChange, group }) {
  const [copied, setCopied] = useState(false);

  const inviteLink = getInviteLink(group?.invite_code || "");
  const shareMessage = `Join my group "${group?.name}" on Strk — Build streaks. Stay accountable. ${inviteLink}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({ title: group?.name, text: shareMessage, url: inviteLink });
    } else {
      navigator.clipboard.writeText(shareMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl p-0 flex flex-col"
        style={{ maxHeight: "85vh" }}
      >
        {/* Scrollable area */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 pt-6 pb-4 space-y-5">
          <SheetHeader className="mb-2">
            <SheetTitle>Invite Members</SheetTitle>
          </SheetHeader>

          {/* QR Code */}
          {group?.invite_code && (
            <div className="flex justify-center">
              <div className="p-4 bg-white rounded-2xl shadow-sm border border-border">
                <QRCodeSVG value={inviteLink} size={140} />
              </div>
            </div>
          )}

          {/* Invite code */}
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-1">Invite code</p>
            <p className="text-2xl font-bold tracking-widest font-mono">{group?.invite_code || "——"}</p>
          </div>

          {/* Link row */}
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex-1 min-w-0 bg-muted rounded-xl px-3 py-2.5 overflow-hidden">
              <span className="text-xs font-mono text-muted-foreground block truncate whitespace-nowrap">
                {truncateMiddle(inviteLink)}
              </span>
            </div>
            <Button variant="outline" size="icon" className="shrink-0" onClick={handleCopy}>
              {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" className="gap-2 rounded-xl h-11" onClick={handleCopy}>
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? "Copied!" : "Copy Link"}
            </Button>
            <Button className="gap-2 rounded-xl h-11" onClick={handleShare}>
              <Share2 className="w-4 h-4" />
              Share
            </Button>
          </div>
        </div>

        {/* Sticky Done button */}
        <div className="px-4 sm:px-6 pb-8 pt-3 border-t border-border bg-background shrink-0">
          <Button
            variant="secondary"
            className="w-full rounded-xl h-11"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}