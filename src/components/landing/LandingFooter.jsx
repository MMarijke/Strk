import { Link } from "react-router-dom";

export default function LandingFooter() {
  return (
    <footer className="px-6 py-10 border-t border-border">
      <div className="max-w-2xl mx-auto flex flex-col items-center gap-3 text-center">
        <div className="flex items-center gap-1.5">
          <span className="text-base leading-none">🔥</span>
          <span className="font-black text-foreground tracking-tight">Strk</span>
        </div>
        <p className="text-xs text-muted-foreground">Build streaks. Stay accountable.</p>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <Link to="/terms" className="underline underline-offset-2 hover:text-foreground">
            Terms of Service
          </Link>
          <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">
            Privacy Policy
          </Link>
        </div>
        <p className="text-[11px] text-muted-foreground/70">© {new Date().getFullYear()} Strk</p>
      </div>
    </footer>
  );
}
