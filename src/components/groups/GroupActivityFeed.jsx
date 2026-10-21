import React from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict, parseISO } from "date-fns";
import { Users, Snowflake } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { getDisplayName } from "@/lib/displayName";

// What the group actually did together, newest first.
//
// This screen used to be a scoreboard of individuals, and three of its
// four blocks were workarounds for the fact that it can honestly say
// almost nothing about other people's habits -- habits_select_own is
// owner-only. The events it CAN evidence are the ones that make this
// product different from a solo tracker: sessions sat together, streaks
// saved for each other, reactions sent. None of them were shown anywhere.
//
// Every source is RLS-scoped to the two parties involved, so this reads
// through get_group_activity (20261021090004), which checks group
// membership explicitly and caps its own window at 14 days. See that
// migration's header for why the window is a privacy control and not just
// a product choice.
const WINDOW_DAYS = 14;

function describeEvent(event, profiles, userEmail) {
  const actor = event.actor_email === userEmail
    ? "You"
    : getDisplayName(event.actor_email, profiles);
  const subject = event.subject_email === userEmail
    ? "your"
    : `${getDisplayName(event.subject_email, profiles)}'s`;

  switch (event.kind) {
    case "session": {
      // detail is the participant count, as a string -- the RPC returns a
      // count rather than a list of emails.
      const others = Math.max(0, Number(event.detail || 0) - 1);
      if (others === 0) return `${actor} focused alone`;
      return `${actor} focused with ${others} ${others === 1 ? "other" : "others"}`;
    }
    case "assist":
      return `${actor} saved ${subject} streak`;
    case "reaction":
      return `${actor} cheered ${event.subject_email === userEmail ? "you" : getDisplayName(event.subject_email, profiles)}`;
    default:
      return null;
  }
}

function EventIcon({ kind, emoji }) {
  if (kind === "session") return <Users className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden="true" />;
  if (kind === "assist") return <Snowflake className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--frozen-text))" }} aria-hidden="true" />;
  // A reaction's own emoji is the content of the event, not an icon
  // standing in for one, so it is rendered rather than replaced.
  return <span className="text-sm leading-none shrink-0" aria-hidden="true">{emoji || "🫶"}</span>;
}

export default function GroupActivityFeed({ groupId, userEmail, profiles = [], memberCount, isSolo }) {
  const { data: events = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["group-activity", groupId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_group_activity", {
        p_group_id: groupId,
        p_since: null,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: !!groupId,
    staleTime: 60_000,
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Activity</p>

      {isLoading ? (
        <div className="space-y-2" role="status" aria-label="Loading activity">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-6 rounded-md bg-primary/10 animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive-text text-xs">
          <span>Couldn&apos;t load what the group&apos;s been up to.</span>
          <button
            type="button"
            onClick={() => refetch()}
            className="font-semibold underline underline-offset-2 shrink-0 h-11 px-1"
          >
            Retry
          </button>
        </div>
      ) : events.length === 0 ? (
        // Three different empty states, because they mean different
        // things. A solo group's feed will stay empty until somebody
        // joins, so pointing at the session button would be a dead end;
        // everyone else gets pointed at the action directly above this
        // card. "No activity" would have covered all three and explained
        // none of them.
        isSolo ? (
          <p className="text-xs text-muted-foreground">
            Activity shows up here once someone else joins the group.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Nothing in the last {WINDOW_DAYS} days. Start a session and it&apos;ll show up here.
          </p>
        )
      ) : (
        <ul className="space-y-2">
          {events.map((event, i) => {
            const text = describeEvent(event, profiles, userEmail);
            if (!text) return null;
            return (
              <li
                key={`${event.kind}-${event.occurred_at}-${event.actor_email}-${i}`}
                className="flex items-center gap-2 text-xs"
              >
                <EventIcon kind={event.kind} emoji={event.detail} />
                <span className="flex-1 min-w-0 truncate text-foreground">{text}</span>
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {formatDistanceToNowStrict(parseISO(event.occurred_at), { addSuffix: false })}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* The disclosure the migration's header requires. Members did not
          agree to group-wide visibility when they sent a reaction, so the
          screen says who can see this rather than leaving it to be
          inferred. Kept to one line, present whether or not the feed has
          anything in it. */}
      {!isSolo && (
        <p className="text-[11px] text-muted-foreground mt-3 pt-3 border-t border-border">
          Everyone in this group can see these {memberCount > 1 ? `· ${memberCount} members` : ""}
        </p>
      )}
    </div>
  );
}
