import React from "react";
import { cn } from "@/lib/utils";

// The lobby's countdown, drawn as a ring around the people instead of as a
// number above them.
//
// The lobby exists to answer one question -- is anyone coming? -- and the
// old layout spent its largest element (a 96px slab) on a number nobody
// can influence, giving a 1-person and a 5-person lobby identical
// treatment. Inverting it puts the participants in the focal position and
// demotes the time to the frame around them.
//
// The sweep is real progress, derived from lobby_ends_at, not decoration:
// a full ring at the start of the lobby, empty when the timer begins.
// Purely visual all the same -- SessionRoom's existing minute-granularity
// live region remains the accessible source of truth for lobby time, so
// this stays out of the accessibility tree entirely rather than competing
// with it.
//
// Sized at 240px so it clears a 320px viewport's 272px of usable width
// (px-6) with room to spare, and fixed rather than scaling with headcount:
// the cluster inside caps its avatars, so the ring never has to grow.
const SIZE = 240;
const STROKE = 4;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function LobbyRing({ fractionRemaining, children }) {
  // Clamped because lobby_ends_at is compared against the viewer's own
  // clock: a device running behind the server can briefly compute more
  // than a full lobby remaining, which would otherwise render a ring
  // overshooting its own circumference.
  const fraction = Math.min(1, Math.max(0, fractionRemaining));

  return (
    <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="absolute inset-0 -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
          // The tween smooths the once-per-second step so the ring reads as
          // continuous rather than ticking. Under reduced motion the
          // transition is dropped and it steps instead -- the information is
          // in the arc length either way, so nothing is lost by not
          // animating it.
          className={cn(
            "transition-[stroke-dashoffset] duration-1000 ease-linear",
            "motion-reduce:transition-none"
          )}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
        {children}
      </div>
    </div>
  );
}
