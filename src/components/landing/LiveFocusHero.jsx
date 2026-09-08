import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

// A perpetually-looping illustrative countdown -- not a real session, just
// the actual SessionRoom.jsx timer treatment (same digit scale, same
// tabular-nums, same avatar/pulse-dot language) run here so a first-time
// visitor sees the mechanism working rather than a screenshot of it. The
// "Live demo" pill exists so nobody mistakes this for their own session.
const DEMO_START_SECS = 44 * 60 + 11;

function pad(n) {
  return String(Math.floor(n)).padStart(2, "0");
}

function formatCountdown(totalSecs) {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${pad(s)}`;
}

const DEMO_PARTICIPANTS = [
  { initial: "J", name: "jordan" },
  { initial: "M", name: "mila" },
];

function DemoParticipant({ initial, name }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative">
        <div className="w-11 h-11 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
          {initial}
        </div>
        <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 border-background animate-pulse" />
      </div>
      <span className="text-[11px] text-muted-foreground">{name}</span>
    </div>
  );
}

export default function LiveFocusHero() {
  const [secsLeft, setSecsLeft] = useState(DEMO_START_SECS);

  useEffect(() => {
    const t = setInterval(() => {
      setSecsLeft((s) => (s <= 0 ? DEMO_START_SECS : s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="relative px-6 pt-14 pb-16 sm:pt-20 sm:pb-24 text-center overflow-hidden">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] -z-10"
        style={{
          background: "radial-gradient(60% 50% at 50% 0%, hsl(var(--accent) / 0.25), transparent)",
        }}
        aria-hidden="true"
      />

      <div className="flex items-center justify-center gap-2 mb-10">
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
          <span className="text-lg">🔥</span>
        </div>
        <span className="text-lg font-black text-foreground tracking-tight">Strk</span>
      </div>

      <div className="max-w-xs mx-auto rounded-3xl bg-card border border-border shadow-xl px-6 py-7">
        <div className="flex items-center justify-center gap-1.5 mb-4">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
          </span>
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
            Live demo · focus session
          </span>
        </div>

        <div className="text-6xl sm:text-7xl font-black tabular-nums tracking-tight text-foreground">
          {formatCountdown(secsLeft)}
        </div>
        <p className="text-xs text-muted-foreground mt-1.5 mb-6">remaining</p>

        <div className="flex items-center justify-center gap-6">
          {DEMO_PARTICIPANTS.map((p) => (
            <DemoParticipant key={p.name} {...p} />
          ))}
        </div>
      </div>

      <h1 className="mt-10 text-3xl sm:text-4xl font-extrabold text-foreground tracking-tight text-balance">
        You're never doing this alone.
      </h1>
      <p className="mt-3 text-muted-foreground text-sm sm:text-base max-w-md mx-auto leading-relaxed text-balance">
        Strk turns habit streaks into something friends build together —
        real people, showing up at the same time, watching progress happen
        live instead of logged in private.
      </p>

      <div className="mt-8 flex flex-col items-center gap-3">
        <Link to="/login" className="w-full max-w-xs">
          <Button
            size="lg"
            className="w-full rounded-2xl h-14 text-base font-bold shadow-xl transition-all duration-300"
          >
            Sign in
          </Button>
        </Link>
        <a href="#pricing" className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground">
          See plans and pricing
        </a>
      </div>
    </header>
  );
}
