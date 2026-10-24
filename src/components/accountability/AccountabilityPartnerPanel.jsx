import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Handshake, Flame, Bell, X, Check, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import LoadErrorStrip from "@/components/ui/load-error-strip";
import { toast } from "sonner";
import { AccountabilityPartnership } from "@/api/entities";
import {
  requestPartner, respondToPartnerRequest, endPartnership, getPartnerDashboard, sendNudge,
} from "@/lib/accountabilityService";
import { getDisplayName } from "@/lib/displayName";
import { trackEvent } from "@/lib/analytics";
import InvitePartnerModal from "./InvitePartnerModal";

// Real per-habit rows always carry a habit_id; a partner with zero habits
// still returns exactly one row (get_partner_dashboard left-joins habits)
// so partner_name/avatar are available, with habit_id null as the only
// signal to skip it when rendering the habit list itself.
function habitRows(partnerHabits) {
  return partnerHabits.filter((h) => h.habit_id);
}

export default function AccountabilityPartnerPanel({ userEmail, profiles = [], groupmateEmails = [], isPro, onUpgradeClick }) {
  const queryClient = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const {
    data: partnerships = [],
    isLoading,
    isError: partnershipsError,
    refetch: refetchPartnerships,
  } = useQuery({
    queryKey: ["accountability-partnerships", userEmail],
    queryFn: () => userEmail
      ? AccountabilityPartnership.filter({ $or: [{ requester_email: userEmail }, { partner_email: userEmail }] })
      : [],
    enabled: !!userEmail,
  });

  const activePartnership = partnerships.find((p) => p.status === "active");
  const pendingIncoming = partnerships.find((p) => p.status === "pending" && p.partner_email === userEmail);
  const pendingOutgoing = partnerships.find((p) => p.status === "pending" && p.requester_email === userEmail);

  const {
    data: partnerHabits = [],
    isLoading: dashboardLoading,
    isError: dashboardError,
    refetch: refetchDashboard,
  } = useQuery({
    queryKey: ["partner-dashboard", activePartnership?.id],
    queryFn: getPartnerDashboard,
    enabled: !!activePartnership,
    staleTime: 60 * 1000,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["accountability-partnerships", userEmail] });
    queryClient.invalidateQueries({ queryKey: ["partner-dashboard"] });
  };

  const requestMutation = useMutation({
    mutationFn: (email) => requestPartner(email),
    onSuccess: (_, email) => {
      trackEvent("accountability_partner_requested");
      invalidateAll();
      toast.success(`Invite sent to ${email}`, { duration: 3000 });
    },
  });

  const respondMutation = useMutation({
    mutationFn: ({ id, accept }) => respondToPartnerRequest(id, accept),
    onSuccess: (_, { accept }) => {
      if (accept) trackEvent("accountability_partner_accepted");
      invalidateAll();
      toast.success(accept ? "You're paired up! 🤝" : "Invite declined", { duration: 3000 });
    },
    onError: () => toast.error("Couldn't respond to that invite. Please try again.", { duration: 3000 }),
  });

  const endMutation = useMutation({
    mutationFn: (id) => endPartnership(id),
    onSuccess: () => {
      invalidateAll();
      setConfirmEnd(false);
      toast.success("Partnership ended", { duration: 2500 });
    },
    onError: () => toast.error("Couldn't end that partnership. Please try again.", { duration: 3000 }),
  });

  const nudgeMutation = useMutation({
    mutationFn: sendNudge,
    onSuccess: () => {
      trackEvent("accountability_nudge_sent");
      toast.success("Nudge sent! 👋", { duration: 2500 });
    },
    onError: (error) => {
      if (error?.message?.includes("NUDGE_LIMIT_REACHED")) {
        toast.error("You've already nudged your partner today.", { duration: 3000 });
      } else {
        toast.error("Couldn't send that nudge. Please try again.", { duration: 3000 });
      }
    },
  });

  const handleOpenInvite = () => {
    if (!isPro) {
      onUpgradeClick();
      return;
    }
    setShowInvite(true);
  };

  if (isLoading) {
    return <div className="h-40 rounded-xl bg-card animate-pulse" />;
  }

  // Active partnership: the side-by-side dashboard
  // A failed partnerships read used to fall through to the first-run "Pair up
  // for real accountability" CTA -- so someone WITH a partner was shown the
  // invite flow, and clicking through got them a Postgres rejection. The read
  // failing and having no partner are different facts and now look different.
  if (partnershipsError) {
    return (
      <LoadErrorStrip
        message="Couldn't load your partner."
        onRetry={() => refetchPartnerships()}
      />
    );
  }

  // Zero rows from get_partner_dashboard proves the partnership is no longer
  // active (it filters on status = 'active' and returns early; it left-joins
  // habits, so an active partnership always yields at least one row). That
  // invalidates the whole active view, not just the habits card inside it --
  // rendering "this ended" under a live partner header and an enabled Nudge
  // button would be its own contradiction. accountability_partnerships is not
  // in the realtime publication, so a partner ending it reaches this client
  // only via a refetch; until then the cached row still says "active" and
  // this zero-row signal is the only evidence available.
  const partnershipEndedElsewhere = !!activePartnership
    && !dashboardLoading
    && !dashboardError
    && partnerHabits.length === 0;

  if (partnershipEndedElsewhere) {
    return (
      <Card className="border-0 shadow-sm p-5 text-center space-y-3">
        <p className="text-sm font-semibold text-foreground">This partnership has ended</p>
        <p className="text-xs text-muted-foreground">
          Your partner ended it, or it ended on another device.
        </p>
        <Button
          variant="outline"
          className="h-11"
          onClick={() => { refetchPartnerships(); refetchDashboard(); }}
        >
          Refresh
        </Button>
      </Card>
    );
  }

  if (activePartnership) {
    const partnerEmail = activePartnership.requester_email === userEmail
      ? activePartnership.partner_email
      : activePartnership.requester_email;
    // Sourced from get_partner_dashboard's own narrow projection, not the
    // wider `profiles` list -- a private partner's profile row is never
    // fetched by the generic profiles query, only this specific RPC.
    const partnerName = partnerHabits[0]?.partner_name || partnerEmail.split("@")[0];
    const rows = habitRows(partnerHabits);

    return (
      <div className="space-y-4">
        <Card className="border-0 shadow-sm p-4">
          <div className="flex items-center justify-between gap-3 mb-1">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                <Handshake className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{partnerName}</p>
                <p className="text-xs text-muted-foreground">Your accountability partner</p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 shrink-0"
              onClick={() => nudgeMutation.mutate()}
              disabled={nudgeMutation.isPending}
            >
              <Bell className="w-3.5 h-3.5" /> Nudge
            </Button>
          </div>
        </Card>

        <Card className="border-0 shadow-sm p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            {partnerName}'s habits
          </p>
          {/* Three outcomes that used to collapse into one sentence, and the
              distinction is load-bearing:

                * dashboardError -- the fetch failed. Said so, with a Retry.
                * partnerHabits.length === 0 -- the PARTNERSHIP is gone.
                  get_partner_dashboard filters on status = 'active' and
                  returns early, so zero rows is only reachable once the
                  partnership is no longer active. It left-joins habits, so an
                  active partnership always yields at least one row. Zero rows
                  therefore PROVES the partnership ended -- it cannot mean
                  "no habits".
                * rows.length === 0 with rows present -- that one row has a
                  null habit_id, which is exactly the left join reporting a
                  partner who genuinely tracks nothing. Here "No active habits
                  yet." is true.

              Before this, all three rendered the third message, so an ended
              partnership and a failed request both read as your partner having
              given up on every habit they had -- attributed to them by name in
              the heading directly above. */}
          {dashboardLoading ? (
            <div className="space-y-2" role="status" aria-label="Loading your partner's habits">
              {[1, 2].map((i) => <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />)}
            </div>
          ) : dashboardError ? (
            <LoadErrorStrip
              message="Couldn't load their habits."
              onRetry={() => refetchDashboard()}
            />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No active habits yet.</p>
          ) : (
            <div className="space-y-2">
              {rows.map((h) => (
                <div key={h.habit_id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-2.5">
                  <span className="text-sm font-medium text-foreground truncate">{h.habit_name}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="flex items-center gap-1 text-sm font-bold tabular-nums">
                      <Flame className={h.current_streak > 0 ? "w-3.5 h-3.5 text-accent" : "w-3.5 h-3.5 text-muted-foreground/40"} />
                      {h.current_streak}
                    </span>
                    <span className={
                      h.completed_today
                        ? "text-[10px] font-bold text-primary"
                        : "text-[10px] text-muted-foreground"
                    }>
                      {h.completed_today ? "Done today" : "Not yet"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {confirmEnd ? (
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" className="flex-1" onClick={() => endMutation.mutate(activePartnership.id)} disabled={endMutation.isPending}>
              {endMutation.isPending ? "Ending…" : "Yes, end partnership"}
            </Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={() => setConfirmEnd(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmEnd(true)}
            className="text-xs text-muted-foreground hover:text-destructive transition-colors w-full text-center"
          >
            End partnership
          </button>
        )}
      </div>
    );
  }

  // Pending incoming invite: someone wants to pair with me
  if (pendingIncoming) {
    const requesterName = getDisplayName(pendingIncoming.requester_email, profiles);
    return (
      <Card className="border-0 shadow-sm p-5 bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20">
        <div className="flex items-center gap-2 mb-2">
          <Handshake className="w-4 h-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">Partner invite</p>
        </div>
        <p className="text-sm text-foreground mb-4">
          <span className="font-semibold">{requesterName}</span> wants to be your Accountability Partner.
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1 gap-1.5"
            onClick={() => respondMutation.mutate({ id: pendingIncoming.id, accept: true })}
            disabled={respondMutation.isPending}
          >
            <Check className="w-3.5 h-3.5" /> Accept
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 gap-1.5"
            onClick={() => respondMutation.mutate({ id: pendingIncoming.id, accept: false })}
            disabled={respondMutation.isPending}
          >
            <X className="w-3.5 h-3.5" /> Decline
          </Button>
        </div>
      </Card>
    );
  }

  // Pending outgoing invite: waiting on someone else
  if (pendingOutgoing) {
    return (
      <Card className="border-0 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-2">
          <Handshake className="w-4 h-4 text-muted-foreground" />
          <p className="text-sm font-semibold text-foreground">Invite sent</p>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Waiting for <span className="font-medium text-foreground">{pendingOutgoing.partner_email}</span> to accept.
        </p>
        <Button size="sm" variant="outline" onClick={() => endMutation.mutate(pendingOutgoing.id)} disabled={endMutation.isPending}>
          {endMutation.isPending ? "Cancelling…" : "Cancel invite"}
        </Button>
      </Card>
    );
  }

  // No relationship at all
  return (
    <div className="flex flex-col items-center text-center py-16 px-4 space-y-4">
      <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mb-2">
        <Handshake className="w-9 h-9 text-primary" />
      </div>
      <h3 className="text-lg font-bold text-foreground">Pair up for real accountability</h3>
      <p className="text-sm text-muted-foreground max-w-xs">
        Pick one person as your dedicated partner — see each other's streaks side by side, and send a nudge when it counts.
      </p>
      <Button onClick={handleOpenInvite} className="gap-2 rounded-full px-5">
        {isPro ? <Handshake className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
        {isPro ? "Invite a Partner" : "Upgrade to invite a partner"}
      </Button>

      <InvitePartnerModal
        open={showInvite}
        onOpenChange={setShowInvite}
        groupmateEmails={groupmateEmails}
        profiles={profiles}
        onInvite={(email) => requestMutation.mutateAsync(email)}
      />
    </div>
  );
}
