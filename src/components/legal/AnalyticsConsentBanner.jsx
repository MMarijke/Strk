import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { getAnalyticsConsent, setAnalyticsConsent } from "@/lib/analyticsConsent";
import { initAnalytics } from "@/lib/analytics";

// Mounted globally in App.jsx (outside the auth gate -- PostHog previously
// initialized on the public landing page too, before any login) so this
// shows on first visit regardless of auth state. Decision persists via
// localStorage (see analyticsConsent.js); revisit anytime from Settings.
export default function AnalyticsConsentBanner() {
  const [decided, setDecided] = useState(() => getAnalyticsConsent() !== null);

  if (decided) return null;

  const decide = (granted) => {
    setAnalyticsConsent(granted ? "granted" : "denied");
    if (granted) initAnalytics();
    setDecided(true);
  };

  return (
    <div className="fixed bottom-0 inset-x-0 z-[60] border-t border-border bg-card px-4 py-4 shadow-lg">
      <div className="max-w-2xl mx-auto flex flex-col sm:flex-row sm:items-center gap-3">
        <p className="text-xs text-muted-foreground flex-1">
          We'd like to use privacy-friendly analytics to see how Strk is used and improve it.
          No data is sold or shared with advertisers. See our{" "}
          <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
        </p>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => decide(false)}>Decline</Button>
          <Button size="sm" onClick={() => decide(true)}>Accept</Button>
        </div>
      </div>
    </div>
  );
}
