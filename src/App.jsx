import { useEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Toaster } from "@/components/ui/sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import Login from './pages/Login';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import Trends from './pages/Trends';
import Social from './pages/Social';
import Settings from './pages/Settings';
import Badges from './pages/Badges';
import Subscription from './pages/Subscription';
import Terms from './pages/Terms';
import Privacy from './pages/Privacy';
import AppLayout from './components/layout/AppLayout';
import { ThemeProvider, useTheme } from './lib/ThemeContext';
import OnboardingThemePicker from './components/onboarding/OnboardingThemePicker';
import OnboardingDisplayName from './components/onboarding/OnboardingDisplayName';

// Sits inside AuthProvider so it can read the authenticated user id
// and pass it to ThemeProvider for per-user localStorage key scoping.
// ThemeProvider itself re-syncs its state when userId changes (auth
// resolves asynchronously after this first mounts with userId=undefined)
// — see the comment in ThemeContext.jsx.
function ThemeProviderWithUser({ children }) {
  const { user } = useAuth();
  return (
    <ThemeProvider userId={user?.id}>
      {children}
    </ThemeProvider>
  );
}

// How long the "you're back" confirmation stays up after a late self-heal
// (see the wasFailedRef effect below) before handing off to the next
// screen -- long enough that a thumb already mid-motion toward the old
// Refresh button lands on inert confirmation text instead of whatever
// renders next.
const RECOVERY_CONFIRM_MS = 900;

// Same icon tile Login.jsx opens with (w-14 h-14 rounded-2xl bg-primary/10
// + 🔥). Reused as-is, not reinvented, so the loading/recovery/failure
// states that bracket Login on every app open read as one continuous,
// intentionally-branded sequence instead of unbranded scaffolding
// sandwiched between two branded screens. Purely decorative -- the
// actual state is always carried by real text and roles below it, so
// this stays out of the accessibility tree.
function BrandMark() {
  return (
    <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center" aria-hidden="true">
      <span className="text-2xl">🔥</span>
    </div>
  );
}

const AuthenticatedApp = () => {
  const { pathname } = useLocation();
  const { isAuthenticated, isLoadingAuth, sessionCheckFailed, sessionCheckOffline, sessionCheckAttempts } = useAuth();
  const { onboarded, onboardStep, completeTheme, completeDisplayName } = useTheme();

  // The session-check-failed screen can clear itself on its own (a late
  // getSession()/onAuthStateChange resolution after the timeout already
  // fired -- see AuthContext's "self-healing" comment). Swapping the
  // whole screen out instantly the moment that happens risks a mid-tap:
  // someone's thumb moving toward the old Refresh button can land on
  // whatever renders in its place instead. Holding a brief inert
  // confirmation here first closes that gap.
  const wasFailedRef = useRef(false);
  const [justRecovered, setJustRecovered] = useState(false);

  useEffect(() => {
    if (sessionCheckFailed) {
      wasFailedRef.current = true;
      return;
    }
    if (!wasFailedRef.current) return;
    wasFailedRef.current = false;
    setJustRecovered(true);
    const timer = setTimeout(() => setJustRecovered(false), RECOVERY_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [sessionCheckFailed]);

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4" role="status">
        <BrandMark />
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" aria-hidden="true"></div>
        <span className="sr-only">Checking your session…</span>
      </div>
    );
  }

  if (justRecovered) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center" role="status">
        <BrandMark />
        <CheckCircle2 className="w-8 h-8 text-emerald-600" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">You're back — continuing…</p>
      </div>
    );
  }

  // Distinct from a normal logged-out visitor -- this means the initial
  // session check itself never completed (a hang past the timeout, or a
  // rejected getSession() call), not that we confirmed there's no
  // session. Surfacing that difference instead of silently falling
  // through to the ordinary Login screen, which would look identical to
  // "you're just not signed in" and hide that something actually broke.
  if (sessionCheckFailed) {
    const failureMessage = sessionCheckOffline
      ? "You're offline. Reconnect, then tap Refresh to pick up where you left off."
      : sessionCheckAttempts >= 2
        ? "Still having trouble reaching our servers. Check your connection, then try again."
        : "Couldn't verify your session. Please check your connection and refresh.";

    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <BrandMark />
        <p className="text-sm text-muted-foreground max-w-xs" role="alert">
          {failureMessage}
        </p>
        <Button
          onClick={() => window.location.reload()}
          size="lg"
          className={cn(
            "w-full max-w-xs rounded-2xl h-14 text-base font-bold transition-all duration-300",
            "shadow-xl"
          )}
        >
          Refresh
        </Button>
      </div>
    );
  }

  // "/" is the public landing page (product description + live pricing --
  // see PRODUCT.md/Landing.jsx), "/login" is the bare sign-in form it links
  // to. Any other path while logged out (a bookmarked /Dashboard link,
  // say) sends the visitor to the landing page rather than straight into a
  // context-free sign-in form.
  if (!isAuthenticated) {
    if (pathname === "/login") return <Login />;
    if (pathname !== "/") return <Navigate to="/" replace />;
    return <Landing />;
  }

  if (!onboarded) {
    if (onboardStep === "name") return <OnboardingDisplayName onComplete={completeDisplayName} />;
    return <OnboardingThemePicker onComplete={completeTheme} />;
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/Dashboard" replace />} />
      <Route path="/login" element={<Navigate to="/Dashboard" replace />} />
      <Route element={<AppLayout />}>
        <Route path="/Dashboard" element={<Dashboard />} />
        <Route path="/Trends" element={<Trends />} />
        <Route path="/Social" element={<Social />} />
        <Route path="/Settings" element={<Settings />} />
        <Route path="/Badges" element={<Badges />} />
        <Route path="/Subscription" element={<Subscription />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <ThemeProviderWithUser>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            {/* /terms and /privacy are matched here, before AuthenticatedApp's
                auth gate -- AuthenticatedApp only renders <Landing/> for "/"
                and <Login/> for "/login" when unauthenticated, redirecting
                every other path (including these two) to "/" before its own
                nested <Routes> ever sees them. These two must stay publicly
                reachable regardless of auth state (Paddle verification, app
                store requirements), so they're matched at this top level
                instead, ahead of the catch-all that hands everything else
                to AuthenticatedApp. */}
            <Routes>
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/*" element={<AuthenticatedApp />} />
            </Routes>
          </Router>
          <Toaster />
        </QueryClientProvider>
      </ThemeProviderWithUser>
    </AuthProvider>
  );
}

export default App