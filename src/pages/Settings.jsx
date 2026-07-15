import React, { useState, useEffect } from "react";
import { Moon, Sun, Palette, Medal, BarChart2, User, Trash2, LogOut, Sparkles } from "lucide-react";
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
import { Habit, UserProfile } from "@/api/entities";
import { useAuth } from "@/lib/AuthContext";
import { getMyProfile, saveMyDisplayName } from "@/lib/displayName";
import { openProCheckout } from "@/lib/paddleService";

export default function Settings() {
  const { themeId, setThemeId, isDark, setIsDark } = useTheme();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const notifSupported = "Notification" in window && Notification.permission === "granted";
  const [weeklySummaryNotif, setWeeklySummaryNotif] = useState(getWeeklySummaryNotifEnabled);
  const [profile, setProfile] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const isPro = profile?.plan === "pro";

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

  const handleUpgrade = () => {
    if (!user) return;
    openProCheckout({ userId: user.id, email: user.email });
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    setDeletingAccount(true);
    // Delete all user habits
    const habits = await Habit.filter({ created_by: user.email });
    await Promise.all(habits.map((h) => Habit.delete(h.id)));
    // Delete user profile
    const profiles = await UserProfile.filter({ created_by: user.email });
    await Promise.all(profiles.map((p) => UserProfile.delete(p.id)));
    // Log out
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

          {/* Strk Pro */}
          <Card className={cn(
            "border-0 shadow-sm p-5",
            isPro && "bg-gradient-to-br from-primary/10 to-accent/10"
          )}>
            <div className="flex items-center gap-3 mb-1">
              <Sparkles className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-sm">Strk Pro</h2>
            </div>
            {isPro ? (
              <>
                <p className="text-xs text-muted-foreground mb-1">
                  You're a Pro member — unlimited streak freezes and more.
                </p>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/20 text-primary mt-2">
                  <Sparkles className="w-3 h-3" /> Pro
                </span>
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-4">
                  Unlock unlimited streak freezes and support Strk's development.
                </p>
                <Button size="sm" onClick={handleUpgrade} className="gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Upgrade to Pro
                </Button>
              </>
            )}
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
            <p className="text-xs text-muted-foreground mb-4">Get a Monday recap of last week's progress</p>
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
                    This will permanently delete all your habits, streaks, and progress. You will be logged out immediately. <strong>This action cannot be undone.</strong>
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
    </div>
  );
}