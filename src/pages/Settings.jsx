import React, { useState, useEffect, useRef } from "react";
import { Moon, Sun, Palette, Medal, BarChart2, User, Trash2, LogOut, Sparkles, FileText, ShieldCheck } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import LoadErrorStrip from "@/components/ui/load-error-strip";
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
  // Push notification: localStorage only, and the only thing
  // scheduleWeeklySummaryNotif() reads. Separate from the email below --
  // see the comment on the Weekly Summary card.
  const [pushNotif, setPushNotif] = useState(getWeeklySummaryNotifEnabled);
  const [analyticsConsent, setAnalyticsConsentState] = useState(() => getAnalyticsConsent() === "granted");
  const [profile, setProfile] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [ownedGroupsWithOthers, setOwnedGroupsWithOthers] = useState([]);
  // Email digest: server-side, read from and written to user_profiles.
  const [emailDigest, setEmailDigest] = useState(false);
  const [savingEmailDigest, setSavingEmailDigest] = useState(false);
  // Both reads now carry an explicit status, because "it failed" and "there
  // is nothing" used to render identically -- and for the group check that
  // difference decides whether a destructive confirmation tells the truth.
  // The nonce is what a Retry increments.
  const [profileStatus, setProfileStatus] = useState("loading");
  const [profileNonce, setProfileNonce] = useState(0);
  const [groupsStatus, setGroupsStatus] = useState("loading");
  const [groupsNonce, setGroupsNonce] = useState(0);
  // setTimeout for the "Saved" confirmation, cleared on unmount so it
  // cannot set state on an unmounted component.
  const nameSavedTimer = useRef(null);
  useEffect(() => () => clearTimeout(nameSavedTimer.current), []);

  // Informational only -- no server-side blocking on this. Deletion still
  // proceeds and cascade-deletes owned groups regardless (see
  // delete-account edge function); this just makes sure the person knows
  // that in advance, since it affects other real people's data.
  //
  // Which is exactly why the failure has to be visible. With no catch, a
  // rejected request left this at [] and the dialog silently dropped the
  // whole "this also deletes groups for other people" disclosure -- a
  // strictly less informed consent screen, indistinguishable from owning
  // no shared groups, in front of an irreversible multi-party action.
  useEffect(() => {
    if (!user?.email) return;
    let cancelled = false;
    setGroupsStatus("loading");
    Group.filter({ created_by: user.email })
      .then((groups) => {
        if (cancelled) return;
        setOwnedGroupsWithOthers(
          groups.filter((g) => (g.member_emails || []).some((e) => e !== user.email))
        );
        setGroupsStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setGroupsStatus("error");
      });
    return () => { cancelled = true; };
  }, [user?.email, groupsNonce]);

  useEffect(() => {
    if (!user?.email) return;
    let cancelled = false;
    setProfileStatus("loading");
    getMyProfile(user.email)
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        setDisplayName(p?.display_name || user.email.split("@")[0]);
        // No row means this user is not in send-weekly-digest's query at
        // all, so no email is being sent -- `false` is the honest reading,
        // not the column default.
        setEmailDigest(p ? p.email_weekly_digest !== false : false);
        setProfileStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setProfileStatus("error");
      });
    return () => { cancelled = true; };
  }, [user?.email, profileNonce]);

  // try/finally, not a bare await: a rejection used to skip
  // setSavingName(false) entirely, leaving the button reading "Saving..."
  // and disabled permanently with no way back but a reload.
  const handleSaveName = async () => {
    const trimmed = displayName.trim();
    if (!trimmed || trimmed.length < 2 || !user) return;
    setSavingName(true);
    try {
      const saved = await saveMyDisplayName(user.email, trimmed);
      // Keep the local profile in step, so the email toggle below is not
      // left pointing at a stale row after a first-time profile creation.
      if (saved) setProfile(saved);
      setNameSaved(true);
      clearTimeout(nameSavedTimer.current);
      nameSavedTimer.current = setTimeout(() => setNameSaved(false), 2000);
    } catch {
      toast.error("Couldn't save your display name. Please try again.", { duration: 4000 });
    } finally {
      setSavingName(false);
    }
  };

  // The weekly summary is TWO channels and used to be one switch.
  //
  // The old handler wrote localStorage (browser notification) and
  // email_weekly_digest (a real Resend send, see
  // supabase/functions/send-weekly-digest) from the same control -- and
  // that control was disabled unless Notification.permission === "granted".
  // email_weekly_digest defaults to true, so anyone who had not granted
  // notification permission (every iOS Safari user, anyone who dismissed
  // the prompt) was receiving a recurring email with the only off-switch
  // greyed out. Worse, `checked` was ANDed with the permission, so the
  // control rendered "off" while the server flag was on: it stated the
  // opposite of the truth.
  //
  // Optimistic with rollback rather than pending-then-commit: the switch
  // should feel immediate, but it must never be left showing a state the
  // server disagrees with.
  const handleEmailDigestToggle = async (val) => {
    if (!profile?.id) return;
    const previous = emailDigest;
    setEmailDigest(val);
    setSavingEmailDigest(true);
    try {
      const updated = await UserProfile.update(profile.id, { email_weekly_digest: val });
      if (updated) setProfile(updated);
    } catch {
      setEmailDigest(previous);
      toast.error(
        val
          ? "Couldn't turn the weekly email on. Please try again."
          : "Couldn't turn the weekly email off. Please try again.",
        { duration: 4000 }
      );
    } finally {
      setSavingEmailDigest(false);
    }
  };

  // Synchronous: localStorage only, and the only input to
  // scheduleWeeklySummaryNotif(). Nothing to fail, nothing to roll back.
  const handlePushNotifToggle = (val) => {
    setPushNotif(val);
    setWeeklySummaryNotifEnabled(val);
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
    let error;
    try {
      ({ error } = await supabase.functions.invoke("delete-account"));
    } catch {
      // invoke() itself throws on a network failure, which previously
      // escaped as an unhandled rejection and left the button on
      // "Deleting..." forever.
      setDeletingAccount(false);
      toast.error("Couldn't reach the server. Your account was not deleted.", { duration: 4000 });
      return;
    }
    if (error) {
      const message = await error.context?.json?.().then((b) => b?.error).catch(() => null);
      setDeletingAccount(false);
      toast.error(message || "Failed to delete account. Please try again.", { duration: 4000 });
      return;
    }
    // Past this point the account is gone server-side. A failed logout must
    // not strand the user on an authenticated-looking page for an account
    // that no longer exists, so the redirect happens either way.
    try {
      await logout();
    } catch {
      // Intentionally swallowed -- the navigation below is the recovery.
    }
    navigate("/");
  };

  // Same stuck-forever shape as handleSaveName had: setSigningOut(false) was
  // never reachable on a rejection, so a failed sign-out left the button
  // reading "Signing out..." for good. Reset only in catch -- on success the
  // component unmounts and setting state after that is the warning.
  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await logout();
      navigate("/");
    } catch {
      setSigningOut(false);
      toast.error("Couldn't sign you out. Please try again.", { duration: 4000 });
    }
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
            {/* Three outcomes that used to look identical. An empty field was
                indistinguishable from a cleared one, and a failed read left
                Save permanently disabled with nothing to explain why. */}
            {profileStatus === "loading" ? (
              <div className="space-y-2" role="status" aria-label="Loading your profile">
                <div className="h-4 w-24 rounded bg-muted animate-pulse" />
                <div className="h-9 rounded-md bg-muted animate-pulse" />
              </div>
            ) : profileStatus === "error" ? (
              <LoadErrorStrip
                message="Couldn't load your profile."
                onRetry={() => setProfileNonce((n) => n + 1)}
              />
            ) : (
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
                      {savingName ? "Saving…" : "Save"}
                    </Button>
                  </div>
                  {/* "Saved" moved out of the button and into a live region.
                      In the button it was announced only if focus happened to
                      remain there, and the checkmark glyph reads literally or
                      is dropped entirely. */}
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <p className="text-xs text-muted-foreground">{displayName.trim().length}/20 characters</p>
                    <p className="text-xs font-medium text-primary" role="status">
                      {nameSaved ? "Saved" : ""}
                    </p>
                  </div>
                </div>
              </div>
            )}
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

            {/* Two channels, two controls. One switch used to write both the
                browser notification and the Resend email, under a label
                naming neither, and it was disabled unless notification
                permission had been granted -- so the email had no reachable
                off-switch for anyone who had not granted it. */}
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label htmlFor="weekly-email" className="text-sm font-medium">Weekly email summary</Label>
                  <p id="weekly-email-hint" className="text-xs text-muted-foreground mt-0.5">
                    {!profile?.id
                      ? "Save a display name first to choose this."
                      : emailDigest
                        ? `Sent to ${user?.email} every Monday`
                        : "You won't get the weekly email"}
                  </p>
                </div>
                <Switch
                  id="weekly-email"
                  checked={emailDigest}
                  disabled={!profile?.id || savingEmailDigest}
                  onCheckedChange={handleEmailDigestToggle}
                  aria-describedby="weekly-email-hint"
                />
              </div>

              <div className="h-px bg-border" aria-hidden="true" />

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label htmlFor="weekly-push" className="text-sm font-medium">Monday push notification</Label>
                  {/* Names the actual blocker rather than instructing the
                      user to do something they may already have refused.
                      notifSupported collapses granted/default/denied into one
                      boolean, so this copy deliberately does not claim which. */}
                  <p id="weekly-push-hint" className="text-xs text-muted-foreground mt-0.5">
                    {notifSupported
                      ? "A reminder at 9:00 AM every Monday"
                      : "Your browser hasn't allowed notifications for Strk"}
                  </p>
                </div>
                <Switch
                  id="weekly-push"
                  checked={pushNotif && notifSupported}
                  disabled={!notifSupported}
                  onCheckedChange={handlePushNotifToggle}
                  aria-describedby="weekly-push-hint"
                />
              </div>
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
            {/* Re-check on open rather than trusting the page-load result:
                it is the freshest it can be at the moment it matters, a
                transient failure earlier self-heals here, and a group
                created since load is accounted for. */}
            <AlertDialog onOpenChange={(open) => { if (open) setGroupsNonce((n) => n + 1); }}>
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
                    {groupsStatus === "loading" && (
                      <>{" "}Checking whether you own groups with other members…</>
                    )}
                    {/* Says so rather than omitting the disclosure. The
                        server cascade happens either way, so a failed check
                        must not read as "you own no shared groups". */}
                    {groupsStatus === "error" && (
                      <>
                        {" "}We couldn&apos;t check whether you own groups with other members. If you do,
                        deleting your account will also delete those groups for everyone in them.
                      </>
                    )}
                    {groupsStatus === "ready" && ownedGroupsWithOthers.length > 0 && (
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
                    disabled={deletingAccount || groupsStatus === "loading"}
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