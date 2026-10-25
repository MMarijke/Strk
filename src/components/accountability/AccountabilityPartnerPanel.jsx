import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Handshake, Flame, Bell, X, Check, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import LoadErrorStrip from "@/components/ui/load-error-strip";
import { toast } from "sonner";
import { AccountabilityPartnership, AccountabilityNudge, AccountabilitySharedHabit, Habit } from "@/api/entities";
import {
  requestPartner, respondToPartnerRequest, endPartnership, getPartnerDashboard, sendNudge,
  getPartnerInvitePreview, setSharedHabits,
} from "@/lib/accountabilityService";
import { groupPartnerColumns, describeToday } from "@/lib/partnerColumns";
import {
  isPartnerNoticeDismissed, dismissPartnerNotice,
  isScopeNoticeDismissed, dismissScopeNotice,
} from "@/lib/partnerNotice";
import { format } from "date-fns";
import { getDisplayName } from "@/lib/displayName";
import { trackEvent } from "@/lib/analytics";
import InvitePartnerModal from "./InvitePartnerModal";
import HabitSharePicker from "./HabitSharePicker";
import ShareScopeModal from "./ShareScopeModal";

// A partnership created before habit scoping existed had its scope
// BACKFILLED by 20261024090001 from whatever that partner could already
// see -- so neither side ever chose it, and they are told once. One created
// after went through the consent screen and must not be told anything, or
// the notice would undercut the choice they just made.
//
// This is the migration's own date, which is the earliest it can have
// applied. If the deploy lands later, a partnership created in between is
// backfilled but shows no notice -- the safe direction, since the scope it
// was given is exactly what that partner could already see.
const SCOPING_SHIPPED_AT = new Date("2026-10-24T00:00:00Z").getTime();

export default function AccountabilityPartnerPanel({ userEmail, profiles = [], groupmateEmails = [], isPro, onUpgradeClick }) {
  const queryClient = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [dismissedId, setDismissedId] = useState(null);
  // Nothing pre-selected on the accept screen: a pre-ticked list is
  // consent the user never gave. The button's own label carries the
  // consequence instead.
  const [acceptSelection, setAcceptSelection] = useState([]);
  const [shareEditorOpen, setShareEditorOpen] = useState(false);
  const [shareEditorInitial, setShareEditorInitial] = useState([]);
  const [scopeNoticeDismissed, setScopeNoticeDismissed] = useState(false);
  // Swapping the "End partnership" trigger for the confirm pair unmounts the
  // focused element, which drops focus to <body> -- a keyboard user lands
  // nowhere and hears nothing. Focus moves to the confirm group's safe
  // option instead. An effect rather than a ref callback: a callback refires
  // on every render, so it would steal focus back the moment the mutation
  // flips isPending.
  const keepItRef = useRef(null);
  useEffect(() => {
    if (confirmEnd) keepItRef.current?.focus();
  }, [confirmEnd]);

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

  // What the consent screen discloses. A separate RPC because
  // get_partner_dashboard requires an ACTIVE partnership, which is the
  // very thing being decided here.
  const {
    data: invitePreview = [],
    isLoading: previewLoading,
    isError: previewError,
  } = useQuery({
    queryKey: ["partner-invite-preview", pendingIncoming?.id],
    queryFn: getPartnerInvitePreview,
    enabled: !!pendingIncoming,
    staleTime: 60 * 1000,
  });

  // What the requester themselves offered, for the pending-invite view.
  // No RPC needed: accountability_shared_habits is owner-selectable and the
  // requester owns the habits in question, so the names resolve from their
  // own list -- the same property that let the nudge toast name a habit
  // without widening what crosses the partnership boundary.
  const { data: myScope = [] } = useQuery({
    queryKey: ["my-shared-habits", pendingOutgoing?.id],
    queryFn: () => AccountabilitySharedHabit.filter({ partnership_id: pendingOutgoing.id }),
    enabled: !!pendingOutgoing,
  });
  const { data: myHabits = [] } = useQuery({
    queryKey: ["habits", userEmail],
    queryFn: () => (userEmail ? Habit.filter({ created_by: userEmail }, "-created_date") : []),
    staleTime: 5 * 60 * 1000,
    enabled: !!userEmail && !!pendingOutgoing,
  });

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

  // The most recent partnership that is over, if the user has not already
  // dismissed the notice for it.
  //
  // Ordered by created_at rather than responded_at, deliberately:
  // end_accountability_partnership writes
  // `responded_at = coalesce(responded_at, now())`, so ending a partnership
  // that was already active KEEPS the accept timestamp and never records
  // when it ended. created_at is sound here anyway, because
  // enforce_single_active_partnership permits at most one pending-or-active
  // row at a time -- so the newest row IS the user's latest relationship,
  // and if it is terminal that is the one worth reporting.
  const lastTerminal = [...partnerships]
    .filter((p) => p.status === "declined" || p.status === "ended")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  // dismissedId covers this render pass; isPartnerNoticeDismissed covers
  // previous visits. Both, because the state resets on remount and the
  // storage read cannot see a dismissal that just happened in this session
  // before its setState lands.
  const noticeDismissed = !!lastTerminal
    && (dismissedId === lastTerminal.id || isPartnerNoticeDismissed(lastTerminal.id));
  // Only when there is nothing live to show instead -- a new invite or
  // partnership supersedes the news that the last one ended.
  const showTerminalNotice = !!lastTerminal
    && !activePartnership
    && !pendingIncoming
    && !pendingOutgoing
    && !noticeDismissed;
  // Whether this user has already nudged today.
  //
  // The cap is one per day per partnership per sender, enforced in
  // send_accountability_nudge -- but the client never read it, so the
  // button looked identical before and after sending and the second tap of
  // the day was a guaranteed error. Every user who used the feature as
  // presented got a red toast for it.
  //
  // date_trunc('day', now()) is the server's day, and this compares against
  // the client's local one. They can disagree either side of midnight, so
  // the button can read "Nudged today" slightly early or late -- which is
  // the safe direction to be wrong: the server is still the authority, and
  // the NUDGE_LIMIT_REACHED branch below still catches the disagreement.
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const { data: nudgesSent = [] } = useQuery({
    queryKey: ["accountability-nudges-sent", userEmail, todayStr],
    queryFn: () => userEmail
      ? AccountabilityNudge.filter({ sender_email: userEmail }, "-created_date")
      : [],
    enabled: !!userEmail && !!activePartnership,
  });
  const nudgesToday = nudgesSent.filter(
    (n) => n.partnership_id === activePartnership?.id && n.created_date?.slice(0, 10) === todayStr
  );
  const nudgedToday = nudgesToday.length > 0;
  // Which habit today's one nudge was spent on, so that row can say so
  // rather than every row going uniformly dead. Null when the nudge
  // predates per-habit nudging, or when its habit has since been deleted
  // (habit_id is ON DELETE SET NULL so the nudge still counts).
  const nudgedHabitId = nudgesToday[0]?.habit_id || null;

  const scopeWasBackfilled = !!activePartnership
    && new Date(activePartnership.created_at).getTime() < SCOPING_SHIPPED_AT;
  const showScopeNotice = scopeWasBackfilled
    && !scopeNoticeDismissed
    && !isScopeNoticeDismissed(activePartnership?.id);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["accountability-partnerships", userEmail] });
    queryClient.invalidateQueries({ queryKey: ["partner-dashboard"] });
  };

  const requestMutation = useMutation({
    mutationFn: (/** @type {{ email: string, habitIds: string[] }} */ { email, habitIds }) =>
      requestPartner(email, habitIds),
    onSuccess: (_, { email, habitIds }) => {
      trackEvent("accountability_partner_requested", { shared_habit_count: habitIds.length });
      invalidateAll();
      toast.success(`Invite sent to ${email}`, { duration: 3000 });
    },
  });

  const respondMutation = useMutation({
    mutationFn: (/** @type {{ id: string, accept: boolean, habitIds: string[] }} */ { id, accept, habitIds }) =>
      respondToPartnerRequest(id, accept, habitIds),
    onSuccess: (_, { accept, habitIds }) => {
      // shared_habit_count on accept is what makes the reciprocity
      // question answerable: whether disclosing the scope makes people
      // share more or less is not something to guess at.
      trackEvent(
        accept ? "accountability_partner_accepted" : "accountability_partner_declined",
        accept ? { shared_habit_count: habitIds.length } : undefined
      );
      setAcceptSelection([]);
      invalidateAll();
      toast.success(accept ? "You're paired up! 🤝" : "Invite declined", { duration: 3000 });
    },
    onError: () => toast.error("Couldn't respond to that invite. Please try again.", { duration: 3000 }),
  });

  const endMutation = useMutation({
    mutationFn: (/** @type {string} */ id) => endPartnership(id),
    onSuccess: () => {
      invalidateAll();
      setConfirmEnd(false);
      toast.success("Partnership ended", { duration: 2500 });
    },
    onError: () => toast.error("Couldn't end that partnership. Please try again.", { duration: 3000 }),
  });

  const nudgeMutation = useMutation({
    mutationFn: (/** @type {string} */ habitId) => sendNudge(habitId),
    onSuccess: () => {
      trackEvent("accountability_nudge_sent");
      // Flips the button to "Nudged today" without waiting for a refetch
      // window, so the state the user just created is the state they see.
      queryClient.invalidateQueries({ queryKey: ["accountability-nudges-sent", userEmail] });
      toast.success("Nudge sent! 👋", { duration: 2500 });
    },
    onError: (error) => {
      if (error?.message?.includes("NUDGE_LIMIT_REACHED")) {
        // Reachable despite the disabled button when the client's local day
        // and the server's disagree across midnight. Refetch so the button
        // catches up with the server rather than staying wrong.
        queryClient.invalidateQueries({ queryKey: ["accountability-nudges-sent", userEmail] });
        toast.error("You've already nudged your partner today.", { duration: 3000 });
      } else {
        toast.error("Couldn't send that nudge. Please try again.", { duration: 3000 });
      }
    },
  });

  const shareMutation = useMutation({
    mutationFn: (/** @type {string[]} */ habitIds) => setSharedHabits(habitIds),
    onSuccess: (count) => {
      trackEvent("accountability_share_scope_changed", { shared_habit_count: count });
      setShareEditorOpen(false);
      // The partner's view of me changes too, so the dashboard that
      // renders both columns has to be refetched, not just this card.
      queryClient.invalidateQueries({ queryKey: ["partner-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["my-shared-habits"] });
      toast.success(
        count === 0 ? "You're not sharing any habits now." : `Sharing ${count} habit${count === 1 ? "" : "s"}.`,
        { duration: 2500 }
      );
    },
    onError: () => toast.error("Couldn't save what you share. Please try again.", { duration: 3000 }),
  });

  // Seeded from the "you" column rather than a separate read of the scope
  // table: that column IS the caller's current scope, minus any habit
  // that has since been archived -- which is correct to drop, because the
  // dashboard filters archived habits out and the partner cannot see them
  // either way.
  const openShareEditor = (you) => {
    setShareEditorInitial((you?.habits || []).map((h) => h.id));
    setShareEditorOpen(true);
  };

  const handleOpenInvite = () => {
    if (!isPro) {
      onUpgradeClick();
      return;
    }
    setShowInvite(true);
  };

  if (isLoading) {
    return (
      <div
        className="h-40 rounded-xl bg-card animate-pulse"
        role="status"
        aria-label="Loading your accountability partner"
      />
    );
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
  // active: it filters on status = 'active' and returns early, and it builds
  // one row per side from a `sides` CTE and left-joins the share scope onto
  // that -- so an active partnership yields at least TWO rows (an identity
  // row each) however little either side shares. Sharing nothing therefore
  // can never be mistaken for having ended. That invalidates the whole
  // active view, not just one card inside it --
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
    const columns = groupPartnerColumns(partnerHabits);
    const you = columns?.you;
    const partner = columns?.partner;
    // Sourced from get_partner_dashboard's own narrow projection, not the
    // wider `profiles` list -- a private partner's profile row is never
    // fetched by the generic profiles query, only this specific RPC.
    const partnerName = partner?.name || partnerEmail.split("@")[0];

    return (
      <div className="space-y-4">
        {showScopeNotice && (
          <div className="flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2.5" role="status">
            <div className="flex-1 min-w-0 space-y-1.5">
              <p className="text-xs text-muted-foreground">
                You and {partnerName} can see each other&apos;s habits — the same ones as before. You can now choose
                which.
              </p>
              <button
                type="button"
                onClick={() => openShareEditor(you)}
                className="h-11 -my-2 text-xs font-semibold text-primary rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                Choose what to share
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                dismissScopeNotice(activePartnership.id);
                setScopeNoticeDismissed(true);
              }}
              className="h-11 w-11 -my-2.5 -mr-2 flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0 rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label="Dismiss"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* The summary row is the one place the comparison is literal, so
            it stays horizontal at every width. The two habit lists below
            stack on a phone -- they are lists of different things, not
            rows of one table, so nothing is lost by stacking them -- but
            stacking THIS would remove the comparison entirely, which is
            the whole reason both sides are on screen. */}
        <Card className="border-0 shadow-sm p-4">
          <div className="flex items-stretch gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground mb-0.5">You</p>
              <p className="text-sm font-semibold tabular-nums">{describeToday(you)}</p>
            </div>
            <div className="w-px bg-border shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0 text-right">
              <p className="text-xs text-muted-foreground mb-0.5 truncate">{partnerName}</p>
              <p className="text-sm font-semibold tabular-nums">{describeToday(partner)}</p>
            </div>
          </div>
        </Card>

        {dashboardLoading ? (
          <div className="space-y-2" role="status" aria-label="Loading both sets of habits">
            {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />)}
          </div>
        ) : dashboardError ? (
          <LoadErrorStrip
            message="Couldn't load your habits."
            onRetry={() => refetchDashboard()}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Yours first: the column you can act on. */}
            <Card className="border-0 shadow-sm p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  You share
                </p>
                {you && you.total > 0 && (
                  <button
                    type="button"
                    onClick={() => openShareEditor(you)}
                    className="h-11 -my-2 px-2 text-xs font-semibold text-primary rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    Change
                  </button>
                )}
              </div>
              {/* Not an empty state: sharing nothing is a valid choice, so
                  this is a way back to the picker rather than a scolding. */}
              {!you || you.total === 0 ? (
                <div className="py-3 text-center space-y-2">
                  <p className="text-sm text-muted-foreground">
                    You haven&apos;t shared any habits with {partnerName}.
                  </p>
                  <Button size="sm" variant="outline" className="h-11" onClick={() => openShareEditor(you)}>
                    Choose what to share
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {you.habits.map((h) => (
                    <div key={h.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-2.5">
                      <span className="text-sm font-medium text-foreground truncate">{h.name}</span>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="flex items-center gap-1 text-sm font-bold tabular-nums">
                          <Flame
                            className={h.streak > 0 ? "w-3.5 h-3.5 text-accent" : "w-3.5 h-3.5 text-muted-foreground/40"}
                            aria-hidden="true"
                          />
                          {h.streak}
                        </span>
                        <span className={h.completedToday ? "text-[10px] font-bold text-primary" : "text-[10px] text-muted-foreground"}>
                          {h.completedToday ? "Done today" : "Not yet"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="border-0 shadow-sm p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                {partnerName} shares
              </p>
              {/* Three outcomes that used to collapse into one sentence:
                  a failed fetch (handled above), a partnership that has
                  ended (proved by zero rows and handled before this
                  branch), and a partner who has genuinely shared nothing
                  -- which is this, and is now a statement about SHARING
                  rather than a claim that they track no habits. */}
              {!partner || partner.total === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {partnerName} hasn&apos;t shared any habits yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {partner.habits.map((h) => (
                    <div key={h.id} className="flex items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{h.name}</p>
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Flame
                            className={h.streak > 0 ? "w-3 h-3 text-accent" : "w-3 h-3 text-muted-foreground/40"}
                            aria-hidden="true"
                          />
                          <span className="tabular-nums">{h.streak}</span>
                          <span aria-hidden="true">·</span>
                          {h.completedToday ? "Done today" : "Not yet"}
                        </p>
                      </div>
                      {/* One nudge a day for the whole partnership, not per
                          habit -- so choosing a habit is choosing where to
                          spend it. Every row therefore disables together,
                          and the one that was used says so. */}
                      <Button
                        size="sm"
                        variant={nudgedHabitId === h.id ? "secondary" : "outline"}
                        className="h-11 min-w-11 shrink-0 gap-1.5"
                        onClick={() => nudgeMutation.mutate(h.id)}
                        disabled={nudgeMutation.isPending || nudgedToday}
                        aria-label={nudgedToday
                          ? `Already nudged ${partnerName} today. One nudge a day.`
                          : `Nudge ${partnerName} about ${h.name}`}
                      >
                        {nudgedHabitId === h.id
                          ? <><Check className="w-3.5 h-3.5" aria-hidden="true" /> Nudged</>
                          : <Bell className="w-3.5 h-3.5" aria-hidden="true" />}
                      </Button>
                    </div>
                  ))}
                  {nudgedToday && (
                    <p className="text-xs text-muted-foreground text-center pt-1">
                      One nudge a day &mdash; you&apos;ve used today&apos;s.
                    </p>
                  )}
                </div>
              )}
            </Card>
          </div>
        )}

        {confirmEnd ? (
          // role="group" + the named question, so a screen reader reaching
          // either button knows what is being confirmed. Swapping the
          // trigger out used to drop focus to <body> with nothing
          // announced, so Cancel takes focus on open -- the safe default of
          // the two, and it means Escape-by-habit (tab, enter) cancels
          // rather than ends.
          <div className="space-y-2" role="group" aria-label={`End your partnership with ${partnerName}?`}>
            <p className="text-xs text-muted-foreground text-center">
              End your partnership with {partnerName}? They keep their own streaks; you both stop seeing each other&apos;s.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 h-11"
                onClick={() => setConfirmEnd(false)}
                disabled={endMutation.isPending}
                ref={keepItRef}
              >
                Keep it
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="flex-1 h-11"
                onClick={() => endMutation.mutate(activePartnership.id)}
                disabled={endMutation.isPending}
              >
                {endMutation.isPending ? "Ending…" : "End partnership"}
              </Button>
            </div>
          </div>
        ) : (
          // Was a bare <button> with text-xs and no padding -- roughly a
          // 16px hit area, carrying exactly the muted weight this app uses
          // for inert helper copy, on the only irreversible action on the
          // screen. Still quiet, now tappable, and text-destructive-text
          // rather than text-destructive because this is body-size text
          // (src/index.css documents the 3.90:1 vs 4.5:1 reason).
          <button
            onClick={() => setConfirmEnd(true)}
            className="h-11 w-full text-xs text-muted-foreground hover:text-destructive-text transition-colors text-center rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            End partnership
          </button>
        )}

        <ShareScopeModal
          open={shareEditorOpen}
          onOpenChange={setShareEditorOpen}
          userEmail={userEmail}
          partnerName={partnerName}
          initialSelected={shareEditorInitial}
          saving={shareMutation.isPending}
          onSave={(ids) => shareMutation.mutate(ids)}
        />
      </div>
    );
  }

  // Pending incoming invite: someone wants to pair with me. This is also
  // the only moment the user can decide what they share, so the
  // disclosure and the reciprocal choice are the same screen -- they are
  // the same question asked from two ends.
  if (pendingIncoming) {
    const requesterName = invitePreview[0]?.requester_name
      || getDisplayName(pendingIncoming.requester_email, profiles);
    const offered = invitePreview.filter((r) => r.habit_name);

    return (
      <Card className="border-0 shadow-sm p-5 bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20">
        <div className="flex items-center gap-2 mb-2">
          <Handshake className="w-4 h-4 text-primary" aria-hidden="true" />
          <p className="text-sm font-semibold text-foreground">Partner invite</p>
        </div>
        <p className="text-sm text-foreground mb-3">
          <span className="font-semibold">{requesterName}</span> wants to be your Accountability Partner.
        </p>

        {/* What they are offering, before the decision rather than after
            it. Accepting used to grant a standing read of every habit you
            had, with nothing stated anywhere. */}
        <div className="rounded-xl bg-background/60 px-3 py-2.5 mb-4">
          {previewLoading ? (
            <div className="h-4 rounded bg-muted animate-pulse" role="status" aria-label="Loading what they share" />
          ) : previewError ? (
            <p className="text-xs text-muted-foreground">
              Couldn&apos;t load what {requesterName} shares. You&apos;ll see it once you pair.
            </p>
          ) : offered.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {requesterName} hasn&apos;t shared any habits yet.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-1">You&apos;ll see:</p>
              <p className="text-xs font-medium text-foreground">
                {offered.map((r) => r.habit_name).join(" · ")}
              </p>
            </>
          )}
        </div>

        <div className="space-y-1.5 mb-4">
          <p className="text-xs font-medium text-foreground" id="accept-share-label">
            What will {requesterName} see of yours?
          </p>
          <p className="text-xs text-muted-foreground">
            Only the habits you pick &mdash; name, streak and whether you checked in today. Never your past days.
          </p>
          <HabitSharePicker
            userEmail={userEmail}
            selected={acceptSelection}
            onChange={setAcceptSelection}
            disabled={respondMutation.isPending}
            labelledBy="accept-share-label"
          />
        </div>

        <div className="flex gap-2">
          {/* The label states what accepting will do. No pre-ticked list
              deciding it, and no disabled button implying that pairing
              without sharing is not allowed -- it is, it just says so. */}
          <Button
            size="sm"
            className="flex-1 gap-1.5 h-11"
            onClick={() => respondMutation.mutate({
              id: pendingIncoming.id,
              accept: true,
              habitIds: acceptSelection,
            })}
            disabled={respondMutation.isPending}
            aria-label={acceptSelection.length > 0
              ? `Accept ${requesterName}'s invite and share ${acceptSelection.length} habits`
              : `Accept ${requesterName}'s invite without sharing any habits`}
          >
            <Check className="w-3.5 h-3.5" aria-hidden="true" />
            {acceptSelection.length > 0 ? `Accept & share ${acceptSelection.length}` : "Accept without sharing"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-11"
            onClick={() => respondMutation.mutate({ id: pendingIncoming.id, accept: false, habitIds: [] })}
            disabled={respondMutation.isPending}
            aria-label={`Decline ${requesterName}'s partner invite`}
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" /> Decline
          </Button>
        </div>
      </Card>
    );
  }

  // Pending outgoing invite: waiting on someone else -- and still able to
  // change the offer, because an offer you cannot revise before it is
  // accepted is not really an offer.
  if (pendingOutgoing) {
    const offeredIds = myScope.map((r) => r.habit_id);
    const offeredNames = offeredIds
      .map((id) => myHabits.find((h) => h.id === id)?.name)
      .filter(Boolean);

    return (
      <Card className="border-0 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-2">
          <Handshake className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-semibold text-foreground">Invite sent</p>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Waiting for <span className="font-medium text-foreground">{pendingOutgoing.partner_email}</span> to accept.
        </p>

        {/* Shown back rather than taken on trust: the offer was made on a
            different screen, and this is the only place it can still be
            changed for free. */}
        <div className="rounded-xl bg-muted/50 px-3 py-2.5 mb-4">
          <p className="text-xs text-muted-foreground mb-1">
            {offeredNames.length > 0 ? "They'll see:" : "You're not sharing any habits yet."}
          </p>
          {offeredNames.length > 0 && (
            <p className="text-xs font-medium text-foreground">{offeredNames.join(" · ")}</p>
          )}
          <button
            type="button"
            onClick={() => {
              setShareEditorInitial(offeredIds);
              setShareEditorOpen(true);
            }}
            className="h-11 -mb-2 text-xs font-semibold text-primary rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {offeredNames.length > 0 ? "Change" : "Choose what to share"}
          </button>
        </div>

        <Button size="sm" variant="outline" className="h-11" onClick={() => endMutation.mutate(pendingOutgoing.id)} disabled={endMutation.isPending}>
          {endMutation.isPending ? "Cancelling…" : "Cancel invite"}
        </Button>

        <ShareScopeModal
          open={shareEditorOpen}
          onOpenChange={setShareEditorOpen}
          userEmail={userEmail}
          partnerName={getDisplayName(pendingOutgoing.partner_email, profiles)}
          initialSelected={shareEditorInitial}
          saving={shareMutation.isPending}
          onSave={(ids) => shareMutation.mutate(ids)}
        />
      </Card>
    );
  }

  // No relationship at all -- but possibly one that just ended, which used
  // to be rendered as though it had never happened.
  //
  // The notice sits ABOVE the empty state rather than replacing it: the
  // useful next move after being declined is to invite somebody else, so the
  // CTA stays in view. Dismissable, because this is news, not a task.
  const terminalName = lastTerminal
    ? getDisplayName(
        lastTerminal.requester_email === userEmail
          ? lastTerminal.partner_email
          : lastTerminal.requester_email,
        profiles
      )
    : "";

  return (
    <div className="flex flex-col items-center text-center py-16 px-4 space-y-4">
      {showTerminalNotice && (
        <div className="w-full max-w-xs flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2.5 text-left" role="status">
          <p className="text-xs text-muted-foreground flex-1">
            {lastTerminal.status === "declined"
              ? `${terminalName} declined your invite.`
              : `Your partnership with ${terminalName} ended.`}
          </p>
          <button
            type="button"
            onClick={() => {
              dismissPartnerNotice(lastTerminal.id);
              setDismissedId(lastTerminal.id);
            }}
            className="h-11 w-11 -my-2.5 -mr-2 flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0 rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mb-2">
        <Handshake className="w-9 h-9 text-primary" aria-hidden="true" />
      </div>
      <h3 className="text-lg font-bold text-foreground">Pair up for real accountability</h3>
      <p className="text-sm text-muted-foreground max-w-xs">
        Pick one person as your dedicated partner — see each other's streaks side by side, and send a nudge when it counts.
      </p>
      <Button onClick={handleOpenInvite} className="gap-2 rounded-full px-5 h-11">
        {isPro ? <Handshake className="w-4 h-4" aria-hidden="true" /> : <Sparkles className="w-4 h-4" aria-hidden="true" />}
        {isPro ? "Invite a Partner" : "Upgrade to invite a partner"}
      </Button>

      <InvitePartnerModal
        open={showInvite}
        onOpenChange={setShowInvite}
        userEmail={userEmail}
        groupmateEmails={groupmateEmails}
        profiles={profiles}
        onInvite={(email, habitIds) => requestMutation.mutateAsync({ email, habitIds })}
      />
    </div>
  );
}
