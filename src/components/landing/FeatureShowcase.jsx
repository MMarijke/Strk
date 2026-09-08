import { Flame } from "lucide-react";

// Each block recreates the actual in-app visual it describes (the same
// avatar/pill/chip language used in SessionRoom, StreakWidget, and Badges)
// at a smaller scale, rather than a generic icon standing in for the
// feature. The streak flame specifically matches StreakWidget.jsx's own
// treatment (a colored lucide Flame, not an emoji) -- the freeze snowflake
// stays an emoji because that IS the app's real language for it (see
// FreezeIndicator.jsx, HabitCard.jsx), and the badge below uses 🏆, one of
// the actual emoji from badgeDefinitions.js, not an invented medal icon.

function GroupChip() {
  return (
    <div className="flex items-center -space-x-2.5">
      {["A", "S", "P"].map((initial, i) => (
        <div
          key={initial}
          className="w-11 h-11 rounded-full bg-primary/20 border-2 border-card flex items-center justify-center text-primary font-bold"
          style={{ zIndex: 3 - i }}
        >
          {initial}
        </div>
      ))}
      <div className="w-11 h-11 rounded-full bg-muted border-2 border-card flex items-center justify-center text-muted-foreground font-bold text-xs z-0">
        +4
      </div>
    </div>
  );
}

function FreezeChip() {
  return (
    <div className="flex items-center gap-2 bg-muted/60 rounded-xl px-3 py-2 w-fit">
      <Flame className="w-4 h-4" style={{ color: "hsl(var(--primary))", fill: "hsl(var(--primary))", stroke: "none" }} />
      <span className="text-sm font-bold text-foreground tabular-nums">18</span>
      <span className="text-muted-foreground text-xs">day streak</span>
      <span className="mx-1 text-border">·</span>
      <span className="text-base leading-none">❄️</span>
    </div>
  );
}

function TrendChip() {
  const bars = [40, 65, 45, 80, 55, 90, 70];
  return (
    <div className="flex items-end gap-1 h-9 bg-muted/60 rounded-xl px-3 py-2 w-fit">
      {bars.map((h, i) => (
        <div key={i} className="w-1.5 rounded-full bg-primary/70" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

function BadgeChip() {
  return (
    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-accent to-primary flex items-center justify-center text-base shadow-sm">
      🏆
    </div>
  );
}

const SUPPORTING_FEATURES = [
  {
    Chip: FreezeChip,
    title: "Streak freezes",
    body: "Miss a day without losing your streak — 2 free a month, unlimited on Pro.",
  },
  {
    Chip: TrendChip,
    title: "Trends",
    body: "See your consistency over time, full 12-week view on Pro.",
  },
  {
    Chip: BadgeChip,
    title: "Badges & rank",
    body: "Earn badges and climb the rank ladder as your streaks add up.",
  },
];

export default function FeatureShowcase() {
  return (
    <section className="px-6 py-14 max-w-2xl mx-auto">
      <h2 className="text-xl font-extrabold text-foreground tracking-tight text-center mb-2">
        Built to be shared, not just logged
      </h2>
      <p className="text-sm text-muted-foreground text-center max-w-sm mx-auto mb-10">
        Every mechanic in Strk exists to make your progress visible to real friends.
      </p>

      {/* Groups & challenges leads, full-width, as the mechanism the whole
          product is built around -- not one tile among four equal ones. */}
      <div className="rounded-3xl bg-card border border-border p-6 mb-4">
        <GroupChip />
        <h3 className="font-bold text-base text-foreground mt-4 mb-1">Groups & challenges</h3>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
          Start a challenge with your group and watch everyone's progress land
          in one place, live — not just your own.
        </p>
      </div>

      {/* The other three ride as a plain divided list, not a second row of
          matching cards -- these are supporting mechanics, not co-equal
          pillars. */}
      <div className="divide-y divide-border">
        {SUPPORTING_FEATURES.map(({ Chip, title, body }) => (
          <div key={title} className="flex items-center gap-4 py-4">
            <Chip />
            <div>
              <h3 className="font-bold text-sm text-foreground">{title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
