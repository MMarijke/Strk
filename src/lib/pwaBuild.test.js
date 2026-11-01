import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The PWA shell, asserted against source and against the build output.
 *
 * The regression this file exists for: vite-plugin-pwa's default
 * `generateSW` strategy writes its own service worker at /sw.js, which
 * would replace the hand-written one whose ONLY job was the
 * notificationclick handler. Android Chrome throws "Illegal constructor"
 * on a direct `new Notification(...)`, so showNotification.js goes through
 * `registration.showNotification()` — notifications would still appear and
 * would silently do nothing when tapped. No existing test covers that
 * path, and no build step would complain.
 *
 * The build-output assertions are skipped when dist/ is absent, so the
 * suite still passes on a clean checkout; CI runs `npm run build` before
 * `npm test`... it does not, actually — ci.yml runs lint, test, then
 * build. So these are guards for a local verification pass, and the
 * source-level assertions above them are the ones that always run.
 */

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const DIST_SW = path.join(ROOT, "dist", "sw.js");
const hasBuild = fs.existsSync(DIST_SW);

describe("service worker source", () => {
  const sw = () => read("src/sw.js");

  it("keeps the notificationclick handler", () => {
    expect(
      sw().includes('addEventListener("notificationclick"'),
      "Tapping an Android notification would stop focusing the app."
    ).toBe(true);
  });

  it("keeps the handlers showNotification depends on", () => {
    // registration.showNotification() needs an active worker, which needs
    // install + activate to have claimed the client.
    const s = sw();
    expect(s).toContain('addEventListener("install"');
    expect(s).toContain('addEventListener("activate"');
    expect(s).toContain("clients.claim()");
  });

  it("uses setCatchHandler rather than a raw navigation fetch listener", () => {
    // A `fetch` listener calling respondWith() on every navigate request
    // pre-empts Workbox's router and makes the NavigationRoute dead code.
    // That was the first draft's bug.
    const s = sw();
    expect(s).toContain("setCatchHandler");
    expect(s).not.toMatch(/addEventListener\(\s*["']fetch["']/);
  });

  it("does not cache Supabase or Paddle responses", () => {
    // Data caching belongs to the Dexie layer. A Workbox route over the
    // REST API would be a second cache with different staleness rules and
    // no conflict resolution.
    const code = sw()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/supabase/i);
    expect(code).not.toMatch(/paddle/i);
  });
});

describe("vite config", () => {
  const cfg = () => read("vite.config.js");

  it("uses injectManifest, not generateSW", () => {
    expect(cfg()).toMatch(/strategies:\s*['"]injectManifest['"]/);
    expect(cfg()).toMatch(/filename:\s*['"]sw\.js['"]/);
  });

  it("leaves the existing manifest and registration alone", () => {
    // public/manifest.json is already complete and index.html already
    // links it; a generated one would ship two manifests. Registration
    // lives in lib/pwa.js, and two registrations would race.
    expect(cfg()).toMatch(/manifest:\s*false/);
    expect(cfg()).toMatch(/injectRegister:\s*false/);
  });

  it("is off in dev unless explicitly enabled", () => {
    expect(cfg()).toMatch(/enabled:\s*process\.env\.VITE_PWA_DEV === ['"]true['"]/);
  });

  it("raises the precache size limit above the largest chunk", () => {
    // The default 2 MiB silently drops the biggest chunks from the
    // precache, which is exactly the cold-offline-start failure this
    // phase exists to prevent.
    const m = /maximumFileSizeToCacheInBytes:\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(cfg());
    expect(m, "no explicit precache size limit").not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(3);
  });

  it("precaches json, so manifest.json is not left out", () => {
    // It was: the glob listed `webmanifest` and the file is manifest.json.
    const glob = /globPatterns:\s*\[([^\]]*)\]/.exec(cfg());
    expect(glob).not.toBeNull();
    expect(glob[1]).toContain("json");
  });
});

describe("registration", () => {
  const pwa = () => read("src/lib/pwa.js");

  it("registers after load, not during module evaluation", () => {
    // The worker's install step precaches the whole shell. Doing that
    // while the first paint is still competing for bandwidth makes the
    // first visit slower for no benefit.
    expect(pwa()).toMatch(/window\.addEventListener\("load"/);
  });

  it("guards the controllerchange reload", () => {
    // controllerchange can fire more than once; an unguarded reload is a
    // reload loop.
    const s = pwa();
    expect(s).toContain("controllerchange");
    expect(s).toMatch(/if \(reloading\) return;/);
  });

  it("only reports an update when one worker is already in control", () => {
    // Without the controller check every first-ever visit is told an
    // update is ready.
    expect(pwa()).toMatch(/navigator\.serviceWorker\.controller/);
  });

  it("detects iOS standalone, which has no display-mode support", () => {
    const s = pwa();
    expect(s).toContain("display-mode: standalone");
    expect(s).toContain("navigator.standalone");
  });

  it("main.jsx no longer registers the worker itself", () => {
    const main = read("src/main.jsx");
    expect(main).toContain("registerServiceWorker()");
    expect(main).not.toMatch(/navigator\.serviceWorker\.register/);
  });
});

describe("the old worker is gone", () => {
  it("public/sw.js is removed, so it cannot overwrite the built one", () => {
    // Both would land at dist/sw.js.
    expect(fs.existsSync(path.join(ROOT, "public", "sw.js"))).toBe(false);
  });

  it("the offline fallback exists and is self-contained", () => {
    const html = read("public/offline.html");
    // It is reached when the network is down and the shell is not cached,
    // so anything external would fail to load too.
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).toContain("You're offline");
  });
});

describe.skipIf(!hasBuild)("build output", () => {
  const sw = () => fs.readFileSync(DIST_SW, "utf8");
  const manifest = () =>
    JSON.parse(/\[\{"revision"[\s\S]*?\}\]/.exec(sw())[0]).map((e) => e.url);

  it("the generated worker still has notificationclick", () => {
    expect(sw()).toContain("notificationclick");
  });

  it("precaches the shell, the fallback and the manifest", () => {
    const urls = manifest();
    for (const want of ["index.html", "offline.html", "manifest.json"]) {
      expect(urls.some((u) => u.includes(want)), `${want} not precached`).toBe(true);
    }
  });

  it("precaches the large chunks rather than dropping them", () => {
    const urls = manifest();
    expect(urls.filter((u) => u.endsWith(".js")).length).toBeGreaterThan(10);
    expect(urls.some((u) => u.includes("generateCategoricalChart"))).toBe(true);
  });

  it("ships exactly one service worker and one manifest", () => {
    const dist = fs.readdirSync(path.join(ROOT, "dist"));
    expect(dist.filter((f) => f === "sw.js")).toHaveLength(1);
    expect(dist.filter((f) => /manifest/.test(f))).toHaveLength(1);
  });
});
