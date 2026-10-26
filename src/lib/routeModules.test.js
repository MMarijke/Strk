import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Every `lazy(X["/key"])` in App.jsx must resolve to a real entry in
 * routeModules.js, and every entry must point at a file that exists.
 *
 * This is guarding a white screen. `lazy(undefined)` does not fail the
 * build and does not fail typecheck -- the keys are plain strings in a
 * plain object, so a typo like TAB_ROUTE_IMPORTS["/Dashbaord"] compiles,
 * bundles, deploys, and then throws at render on the route it belongs to.
 * For "/Dashboard" that is the first screen after login, i.e. the whole
 * app, and the first sign of it would be a user reporting a blank page.
 *
 * Parsed from source rather than imported, because importing App.jsx pulls
 * in the entire component tree (and supabaseClient, which throws at module
 * scope without env vars). Same approach as badgeIds.test.js and
 * exportCoverage.test.js.
 */

const ROOT = process.cwd();
const APP = path.join(ROOT, "src", "App.jsx");
const REGISTRY = path.join(ROOT, "src", "lib", "routeModules.js");

const REGISTRY_NAMES = [
  "TAB_ROUTE_IMPORTS",
  "OTHER_APP_ROUTE_IMPORTS",
  "AUTH_ROUTE_IMPORTS",
  "LEGAL_ROUTE_IMPORTS",
];

function registrySource() {
  return fs.readFileSync(REGISTRY, "utf8");
}

/** { TAB_ROUTE_IMPORTS: { "/Dashboard": "@/pages/Dashboard", ... }, ... } */
function registries() {
  const src = registrySource();
  const out = {};
  for (const name of REGISTRY_NAMES) {
    const block = new RegExp(`export const ${name}\\s*=\\s*\\{(.*?)\\n\\};`, "s").exec(src);
    const entries = {};
    if (block) {
      const re = /"([^"]+)":\s*\(\)\s*=>\s*import\("([^"]+)"\)/g;
      let m;
      while ((m = re.exec(block[1])) !== null) entries[m[1]] = m[2];
    }
    out[name] = entries;
  }
  return out;
}

/** [["TAB_ROUTE_IMPORTS", "/Dashboard"], ...] from App.jsx's lazy() calls. */
function lazyCallSites() {
  const src = fs.readFileSync(APP, "utf8");
  return [...src.matchAll(/lazy\((\w+)\["([^"]+)"\]\)/g)].map((m) => [m[1], m[2]]);
}

describe("route module registry", () => {
  it("finds the lazy() call sites and the registries", () => {
    // Guards the regexes: without this every assertion below could pass
    // by matching nothing at all.
    expect(lazyCallSites().length).toBeGreaterThan(10);
    const reg = registries();
    for (const name of REGISTRY_NAMES) {
      expect(Object.keys(reg[name]).length, `${name} parsed empty`).toBeGreaterThan(0);
    }
  });

  // The point of the file.
  it("resolves every lazy() key to a registry entry", () => {
    const reg = registries();
    const unresolved = lazyCallSites()
      .filter(([registry, key]) => !reg[registry] || !(key in reg[registry]))
      .map(([registry, key]) => `${registry}["${key}"]`);

    expect(
      unresolved,
      "These App.jsx lazy() calls reference keys that routeModules.js does " +
      "not define, so each is lazy(undefined) -- it builds and deploys " +
      "cleanly and then throws a blank screen on that route."
    ).toEqual([]);
  });

  it("points every registry entry at a file that exists", () => {
    const reg = registries();
    const missing = [];
    for (const name of REGISTRY_NAMES) {
      for (const [key, spec] of Object.entries(reg[name])) {
        const rel = spec.replace(/^@\//, "src/");
        const found = [".jsx", ".js", ""].some((ext) =>
          fs.existsSync(path.join(ROOT, rel + ext))
        );
        if (!found) missing.push(`${name}["${key}"] -> ${spec}`);
      }
    }
    expect(
      missing,
      "These registry entries import paths with no matching file. The " +
      "dynamic import rejects at navigation time, which Suspense surfaces " +
      "as a failed chunk load rather than a page."
    ).toEqual([]);
  });

  it("covers every tab the bottom bar links to", () => {
    // BottomTabBar prefetches by path on pointerdown. A path it links to
    // that the registry does not know is a silent no-op: the prefetch
    // never happens and that tab is always a cold load.
    const bar = fs.readFileSync(
      path.join(ROOT, "src", "components", "layout", "BottomTabBar.jsx"),
      "utf8"
    );
    const barBlock = /const TABS\s*=\s*\[(.*?)\n\];/s.exec(bar);
    expect(barBlock, "TABS not found in BottomTabBar.jsx").not.toBeNull();
    const barPaths = [...barBlock[1].matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(barPaths.length).toBeGreaterThan(0);

    const tabKeys = Object.keys(registries().TAB_ROUTE_IMPORTS);
    const unknown = barPaths.filter((p) => !tabKeys.includes(p));
    expect(
      unknown,
      "BottomTabBar links to these paths but TAB_ROUTE_IMPORTS does not " +
      "list them, so prefetchRoute() silently does nothing for them and " +
      "they stay cold loads."
    ).toEqual([]);
  });
});
