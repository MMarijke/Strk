import React, { useState, useEffect } from "react";
import { Moon, Sun, Palette, Medal, BarChart2, User, Trash2, LogOut, Sparkles, FileText, ShieldCheck } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useTheme, COLOR_THEMES } from "@/lib/ThemeContext";
import { cn } from "@/lib/utils";
import { getWeeklySummaryNotifEnabled, setWeeklySummaryNotifEnabled } from "@/lib/weeklySummaryService";
import { getAnalyticsConsent, setAnalyticsConsent } from "@/lib/analyticsConsent";
import { initAnalytics, disableAnalyticsCapturing } from "@/lib/analytics";
import { Group, UserProfile } from "@/api/entities";
import { useAuth } from "@/lib/AuthContext";
import { getMyProfile, saveMyDisplayName } from "@/lib/displayName";
import { useSubscription } from "@/hooks/useSubscription";
import UpgradeModal from "@/components/upgrade/UpgradeModal";
import { toast } from "sonner";
import { supabase } from "@/api/supabaseClient";

export default function Settings() {
  const { themeId, setThemeId, isDark, setIsDark } = useTheme();
  const { user, logout } = useAuth();
  const { isPro } = useSubscription();
  const navigate = useNavigate();
  const notifSupported = "Notification" in window && Notification.permission === "granted";
  const [weeklySummaryNotif, setWeeklySummaryNotif] = useState(getWeeklySummaryNotifEnabled);
  const [analyticsConsent, setAnalyticsConsentState] = useState(() => getAnalyticsConsent() === "granted");
  const [profile, setProfile] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [ownedGroupsWithOthers, setOwnedGroupsWithOthers] = useState([]);

  // Informational only -- no server-side blocking on this. Deletion still
  // proceeds and cascade-deletes owned groups regardless (see
  // delete-account edge function); this just makes sure the person knows
  // that in advance, since it affects other real people's data.
  useEffect(() => {
    if (!user?.email) return;
    Group.filter({ created_by: user.email }).then((groups) => {
      setOwnedGroupsWithOthers(
        groups.filter((g) => (g.member_emails || []).some((e) => e !== user.email))
      );
    });
  }, [user?.email]);

  useEffect(() => {
    if (!user?.email) return;
    getMyProfile(user.email).then((p) => {
      setProfile(p);
      setDisplayName(p?.display_name || user.email.split("@")[0]);
    });
  }, [user?.email]);

  const handleSaveName = async () => {
    const trimmed = displayName.trim();
    if (!trimmed || trimmed.length < 2 || !user) return;
    setSavingName(true);
    await saveMyDisplayName(user.email, trimmed);
    setSavingName(false);
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 2000);
  };

  const handleWeeklySummaryToggle = (val) => {
    setWeeklySummaryNotif(val);
    setWeeklySummaryNotifEnabled(val);
    if (profile?.id) {
      UserProfile.update(profile.id, { email_weekly_digest: val }).then((updated) => setProfile(updated));
    }
  };

  // Lets someone revisit the AnalyticsConsentBanner decision anytime --
  // GDPR/POPIA requires withdrawing consent to be as easy as giving it.
  const handleAnalyticsConsentToggle = (val) => {
    setAnalyticsConsentState(val);
    setAnalyticsConsent(val ? "granted" : "denied");
    if (val) initAnalytics();
    else disableAnalyticsCapturing();
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    setDeletingAccount(true);
    // delete-account handles everything server-side: cancels any active
    // Paddle subscription, sweeps the user's email out of other people's
    // groups/challenges/sessions/reactions, then calls the Auth Admin API
    // to delete auth.users -- which cascades to remove every row the user
    // owns in one step. See supabase/functions/delete-account/index.ts.
    const { error } = await supabase.functions.invoke("delete-account");
    if (error) {
      const message = await error.context?.json?.().then((b) => b?.error).catch(() => null);
      setDeletingAccount(false);
      toast.error(message || "Failed to delete account. Please try again.", { duration: 4000 });
      return;
    }
    await logout();
    navigate("/");
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await logout();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background">
      <div
        className="max-w-2xl mx-auto px-4 pb-8"
        style={{ paddingTop: `calc(env(safe-area-inset-top) + 2rem)` }}
      >
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Personalize your experience</p>
        </div>

        <div className="space-y-6">
          {/* Profile / Display Name */}
          <Card className="border-0 shadow-sm p-5">
            <div className="flex items-center gap-3 mb-1">
              <User className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-sm">Profile</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4">This name appears on leaderboards and group views</p>
            <div className="space-y-3">
              <div>
                <Label htmlFor="display-name" className="text-sm font-medium">Display name</Label>
                <div className="flex gap-2 mt-1.5">
                  <Input
                    id="display-name"
                    value={displayName}
                    onChange={(e) => { setDisplayName(e.target.value.slice(0, 20)); setNameSaved(false); }}
                    placeholder="Your display name"
                    maxLength={20}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleSaveName}
                    disabled={savingName || displayName.trim().length < 2}
                    size="sm"
                    className="shrink-0"
                  >
                    {nameSaved ? "Saved ✓" : savingName ? "Saving…" : "Save"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{displayName.trim().length}/20 characters</p>
              </div>
            </div>
          </Card>

          {/* Subscription */}
          <Card className={cn(
            "border-0 shadow-sm p-5",
            isPro && "bg-gradient-to-br from-primary/10 to-accent/10"
          )}>
            <div className="flex items-center gap-3 mb-1">
              <Sparkles className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-sm">Subscription</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              {isPro
                ? "Unlimited groups, unlimited streak freezes, and full 12-week analytics."
                : "Upgrade for unlimited groups, unlimited streak freezes, and full 12-week analytics."}
            </p>
            <div className="flex items-center justify-between">
              <span className={cn(
                "inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full",
                isPro ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
              )}>
                {isPro && <Sparkles className="w-3 h-3" />}
                {isPro ? "Pro Plan" : "Free Plan"}
              </span>
              {isPro ? (
                // /Subscription fetches live Paddle state itself (status,
                // price, payment method, management_urls) rather than
                // trusting cached webhook data here — see manage-subscription
                // edge function. It also handles the "no subscription found"
                // case internally, so this link no longer needs to branch on
                // whether profile.paddle_update_payment_method_url exists.
                <Link to="/Subscription" className="text-xs font-medium text-primary hover:underline">
                  Manage Subscription
                </Link>
              ) : (
                <Button size="sm" onClick={() => setShowUpgrade(true)} className="gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Upgrade to Pro
                </Button>
              )}
            </div>
          </Card>

          {/* Dark Mode Toggle */}
          <Card className="border-0 shadow-sm p-5">
            <div className="flex items-center gap-3 mb-1">
              {isDark ? <Moon className="w-4 h-4 text-primary" /> : <Sun className="w-4 h-4 text-accent" />}
              <h2 className="font-semibold text-sm">Appearance</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4">Choose your preferred display mode</p>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="dark-mode" className="text-sm font-medium">Dark Mode</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isDark ? "Currently using dark mode" : "Currently using light mode"}
                </p>
              </div>
              <Switch
                id="dark-mode"
                checked={isDark}
                onCheckedChange={setIsDark}
              />
            </div>
          </Card>

          {/* Color Theme Picker */}
          <Card className="border-0 shadow-sm p-5">
            <div className="flex items-center gap-3 mb-1">
              <Palette className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-sm">Color Theme</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4">Pick a color palette for your app</p>

            {(() => {
              const defaultTheme = COLOR_THEMES.find(t => t.id === "strk");
              const otherThemes = COLOR_THEMES.filter(t => t.id !== "strk");
              return (
                <>
                  {defaultTheme && (() => {
                    const isActive = themeId === defaultTheme.id;
                    return (
                      <button
                        onClick={() => setThemeId(defaultTheme.id)}
                        className={cn(
                          "relative w-full rounded-xl p-3 border-2 transition-all duration-200 text-left mb-3",
                          isActive ? "shadow-md scale-[1.01]" : "border-transparent bg-muted/50 hover:bg-muted"
                        )}
                        style={isActive ? { borderColor: `hsl(${defaultTheme.primary})` } : {}}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex gap-1.5">
                            <div className="w-6 h-6 rounded-full" style={{ backgroundColor: `hsl(${defaultTheme.primary})` }} />
                            <div className="w-6 h-6 rounded-full" style={{ backgroundColor: `hsl(${defaultTheme.accent})` }} />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-foreground">{defaultTheme.label}</p>
                            <p className="text-xs text-muted-foreground">Default</p>
                          </div>
                        </div>
                        {isActive && (
                          <div className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full" style={{ backgroundColor: `hsl(${defaultTheme.primary})` }} />
                        )}
                      </button>
                    );
                  })()}
                  <div className="grid grid-cols-3 gap-3">
                    {otherThemes.map((theme) => {
                      const isActive = themeId === theme.id;
                      return (
                        <button
                          key={theme.id}
                          onClick={() => setThemeId(theme.id)}
                          className={cn(
                            "relative rounded-xl p-3 border-2 transition-all duration-200 text-left",
                            isActive ? "shadow-md scale-[1.02]" : "border-transparent bg-muted/50 hover:bg-muted"
                          )}
                          style={isActive ? { borderColor: `hsl(${theme.primary})` } : {}}
                        >
                          <div className="flex gap-1.5 mb-2">
                            <div className="w-5 h-5 rounded-full" style={{ backgroundColor: `hsl(${theme.primary})` }} />
                            <div className="w-5 h-5 rounded-full" style={{ backgroundColor: `hsl(${theme.accent})` }} />
                          </div>
                          <p className="text-xs font-semibold text-foreground">{theme.label}</p>
                          {isActive && (
                            <div className="absolute top-2 right-2 w-2 h-2 rounded-full" style={{ backgroundColor: `hsl(${theme.primary})` }} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </Card>

          {/* Weekly Summary */}
          <Card className="border-0 shadow-sm p-5">
            <div className="flex items-center gap-3 mb-1">
              <BarChart2 className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-sm">Weekly Summary</h2>
            </div>
            {/* No longer Monday-specific -- isSummaryVisible() now surfaces
                the card on the first open of the week, whichever day that
                is, not only if that happens to be Monday itself. */}
            <p className="text-xs text-muted-foreground mb-4">Get a recap of last week's progress</p>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="weekly-notif" className="text-sm font-medium">Monday Notification</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {notifSupported
                    ? "Send a reminder at 9:00 AM every Monday"
                    : "Enable browser notifications to use this"}
                </p>
              </div>
              <Switch
                id="weekly-notif"
                checked={weeklySummaryNotif && notifSupported}
                disabled={!notifSupported}
                onCheckedChange={handleWeeklySummaryToggle}
              />
            </div>
          </Card>

          {/* Badge Info Link */}
          <Card className="border-0 shadow-sm p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Medal className="w-4 h-4 text-primary" />
                <div>
                  <h2 className="font-semibold text-sm">Badge Guide</h2>
                  <p className="text-xs text-muted-foreground">Learn what each badge means</p>
                </div>
              </div>
              <Link to="/Badges">
                <Button variant="outline" size="sm">View</Button>
              </Link>
            </div>
          </Card>

          {/* Analytics Consent */}
          <Card className="border-0 shadow-sm p-5">
            <div className="flex items-center gap-3 mb-1">
              <ShieldCheck className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-sm">Analytics</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Help us improve Strk with privacy-friendly usage analytics. No data is sold or shared with advertisers.
            </p>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="analytics-consent" className="text-sm font-medium">Allow Analytics</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {analyticsConsent ? "Currently sharing anonymous usage data" : "Currently opted out"}
                </p>
              </div>
              <Switch
                id="analytics-consent"
                checked={analyticsConsent}
                onCheckedChange={handleAnalyticsConsentToggle}
              />
            </div>
          </Card>

          {/* Legal */}
          <Card className="border-0 shadow-sm p-5">
            <div className="flex items-center gap-3 mb-1">
              <FileText className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-sm">Legal</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4">Terms, privacy, and how your data is handled</p>
            <div className="flex gap-4">
              <Link to="/terms" className="text-sm font-medium text-primary hover:underline">
                Terms of Service
              </Link>
              <Link to="/privacy" className="text-sm font-medium text-primary hover:underline">
                Privacy Policy
              </Link>
            </div>
          </Card>

          {/* Sign Out */}
          <Card className="border-0 shadow-sm p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <LogOut className="w-4 h-4 text-primary" />
                <div>
                  <h2 className="font-semibold text-sm">Sign Out</h2>
                  <p className="text-xs text-muted-foreground">{user?.email}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handleSignOut} disabled={signingOut}>
                {signingOut ? "Signing out…" : "Sign Out"}
              </Button>
            </div>
          </Card>

          {/* Account Deletion */}
          <Card className="border-0 shadow-sm p-5 border border-destructive/20">
            <div className="flex items-center gap-3 mb-1">
              <Trash2 className="w-4 h-4 text-destructive" />
              <h2 className="font-semibold text-sm text-destructive">Danger Zone</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Permanently delete your account and all your data. This cannot be undone.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" className="gap-2">
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all your habits, streaks, and progress. You will be logged out immediately.
                    {ownedGroupsWithOthers.length > 0 && (
                      <>
                        {" "}You own {ownedGroupsWithOthers.length} group{ownedGroupsWithOthers.length !== 1 ? "s" : ""} with other members.
                        Deleting your account will also delete {ownedGroupsWithOthers.length !== 1 ? "those groups" : "that group"} for everyone in {ownedGroupsWithOthers.length !== 1 ? "them" : "it"}.
                      </>
                    )}
                    {" "}<strong>This action cannot be undone.</strong>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={handleDeleteAccount}
                    disabled={deletingAccount}
                  >
                    {deletingAccount ? "Deleting…" : "Yes, delete everything"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Card>
        </div>
      </div>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  );
}