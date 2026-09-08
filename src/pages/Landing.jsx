// IMPECCABLE DIRECTION CONTRACT
// THESIS: A habit tracker's hero usually proves itself with a static
//   checklist; this one runs the actual synchronized focus-session
//   countdown live, with a friend already present, because Strk's whole
//   claim is that you're never doing this alone.
// OWN-WORLD: Strk's existing ember system -- warm cream ground, amber/gold
//   primary-accent pair, Inter, soft rounded-2xl/3xl cards, the same
//   shadcn button/card language already used in Login and onboarding.
// STORY: A visitor sees two people mid-session, understands habits here
//   are witnessed live, scrolls the real mechanisms (groups, freezes,
//   trends, badges) each as its actual in-app chip, sees honest Free vs
//   Pro pricing, and signs in.
// FIRST VIEWPORT: centered oversized ticking countdown with two presence
//   avatars and pulse dots, "You're never doing this alone" beneath,
//   Strk wordmark/flame above, one primary Sign in CTA.
// FORM: structural candidate 3 of 7 ("focus-session countdown as hero"),
//   concept-seed key 20192955.
// FINISH: unreviewed and undocumented is unfinished; this build ends with
//   the finish review, the verdict, and DESIGN.md.
import LiveFocusHero from "@/components/landing/LiveFocusHero";
import FeatureShowcase from "@/components/landing/FeatureShowcase";
import PricingSection from "@/components/landing/PricingSection";
import LandingFooter from "@/components/landing/LandingFooter";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background" style={{ userSelect: "text", WebkitUserSelect: "text" }}>
      <LiveFocusHero />
      <FeatureShowcase />
      <PricingSection />
      <LandingFooter />
    </div>
  );
}
