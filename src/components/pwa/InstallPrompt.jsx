import React, { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isInstalled } from "@/lib/pwa";

const DISMISSED_KEY = "strk-install-prompt-dismissed";

/**
 * An offer to install, shown once and never nagged.
 *
 * Chromium fires `beforeinstallprompt` when the app is installable and
 * hands over a deferred prompt. iOS Safari fires nothing and has no
 * programmatic install at all -- the user has to use Share > Add to Home
 * Screen -- so iOS gets instructions rather than a button it cannot
 * honour. Pretending otherwise would ship a button that does nothing on
 * the platform where installing matters most for a habit tracker.
 *
 * Deliberately not a modal. A full-screen interruption for a
 * nice-to-have, on first open, is the pattern that trains people to
 * dismiss everything.
 */
export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      // Private mode or blocked storage: treat as not dismissed. The
      // prompt is then shown each session, which is the lesser wrong
      // compared to never offering it at all.
      return false;
    }
  });

  useEffect(() => {
    if (dismissed || isInstalled()) return;

    const onBeforeInstall = (e) => {
      // Chromium shows its own mini-infobar unless this is prevented.
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // iOS: no event to wait for, so detect the platform instead. Checked
    // for iPad too, which reports as Macintosh with touch points since
    // iPadOS 13.
    const ua = window.navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua)
      || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    if (isIos && isSafari) setShowIosHint(true);

    // installed while the tab was open -- stop offering immediately.
    const onInstalled = () => {
      setDeferredPrompt(null);
      setShowIosHint(false);
    };
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [dismissed]);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Dismissal then lasts the session only. Nothing to recover.
    }
  };

  const install = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      // The outcome is deliberately not branched on. Whether they accept
      // or decline, the prompt is spent -- it cannot be reused -- and
      // re-offering after a decline is nagging.
      await deferredPrompt.userChoice;
    } catch {
      // Rejected or already consumed. Nothing useful to say.
    } finally {
      setDeferredPrompt(null);
      dismiss();
    }
  };

  if (dismissed || isInstalled()) return null;
  if (!deferredPrompt && !showIosHint) return null;

  return (
    <div className="mb-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <Download className="w-4 h-4 mt-0.5 text-primary shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">Add Strk to your home screen</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {showIosHint
              ? "Tap Share, then “Add to Home Screen”. It opens full screen and works without a connection."
              : "It opens full screen and works without a connection."}
          </p>
          {deferredPrompt && (
            <Button size="sm" className="h-11 mt-3 w-full" onClick={install}>
              Install
            </Button>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="shrink-0 -m-1 p-1 min-h-11 min-w-11 flex items-center justify-center rounded-lg text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
