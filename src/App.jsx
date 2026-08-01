import { Toaster } from "@/components/ui/toaster"
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
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const { onboarded, onboardStep, completeTheme, completeDisplayName } = useTheme();

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin"></div>
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
            <AuthenticatedApp />
          </Router>
          <Toaster />
        </QueryClientProvider>
      </ThemeProviderWithUser>
    </AuthProvider>
  );
}

export default App