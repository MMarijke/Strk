import { Toaster } from "@/components/ui/sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import Login from './pages/Login';
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

const AuthenticatedApp = () => {
  const { isAuthenticated, isLoadingAuth, sessionCheckFailed } = useAuth();
  const { onboarded, onboardStep, completeTheme, completeDisplayName } = useTheme();

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin"></div>
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
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-muted-foreground max-w-xs">
          Couldn't verify your session. Please check your connection and refresh.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold"
        >
          Refresh
        </button>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  if (!onboarded) {
    if (onboardStep === "name") return <OnboardingDisplayName onComplete={completeDisplayName} />;
    return <OnboardingThemePicker onComplete={completeTheme} />;
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/Dashboard" replace />} />
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
                auth gate -- AuthenticatedApp short-circuits to <Login/> for
                *any* path when unauthenticated, so routes nested inside its
                own <Routes> block are unreachable while logged out. These
                two must stay publicly reachable (Paddle verification, app
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