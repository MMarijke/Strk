# Offline support

Status: **phase 1 of 4 shipped.** The app shell works offline; data does not yet.

| phase | what | state |
|---|---|---|
| 1 | PWA shell: precached assets, offline fallback, install prompt | **done** |
| 2 | Dexie mirror + read-through at the entities layer | not started |
| 3 | Outbox + sync engine | not started |
| 4 | Sync status UI, subscription caching | not started |

After phase 1 the app **loads** offline and renders its chrome. Every data
query still goes to Supabase and still fails offline. Do not read this
document as describing a working local-first app yet.

---

## Phase 1: the shell

### Why `injectManifest` and not `generateSW`

`vite-plugin-pwa`'s default `generateSW` writes its own service worker at
`/sw.js`. That would have replaced the hand-written worker whose *only*
job was a `notificationclick` handler.

Android Chrome throws `Illegal constructor` on a direct
`new Notification(...)`, so `src/lib/showNotification.js` goes through
`navigator.serviceWorker.ready` → `registration.showNotification()`. Lose
the handler and notifications still *appear* and silently do nothing when
tapped — a regression no test and no build step would have caught.

So the worker is hand-written at `src/sw.js` and the plugin only injects
the precache manifest into it. `src/lib/pwaBuild.test.js` asserts the
handler is still there, in source and in the build output.

### Caching strategies

| request | strategy | why |
|---|---|---|
| shell + hashed assets | precache | makes a cold offline start work at all |
| navigations | `NetworkFirst`, 4s timeout | see below |
| images | `CacheFirst`, 60d, 80 entries | content-hashed, cannot go stale |
| `fonts.googleapis.com` | `NetworkFirst` | the stylesheet changes; the fonts don't |
| `fonts.gstatic.com` | `CacheFirst`, 1y, 20 entries | without this the app renders in a fallback face offline |
| Supabase / Paddle | **not cached** | data caching is phase 2's job |

**Navigations are `NetworkFirst`, which departs from the original brief's
`stale-while-revalidate`.** SWR serves the cached document and revalidates
behind it, so a user opening the app after a deploy runs the *previous*
`index.html` — which references content-hashed asset filenames that no
longer exist on Vercel. The result is a blank screen until a second
reload. `NetworkFirst` gets identical offline behaviour (falls back to
cache when the network fails) without serving a document that points at
deleted files, and costs almost nothing here because there is one HTML
document and its asset graph is already precached.

**Supabase is deliberately uncached.** A Workbox route over the REST API
would be a second cache with different staleness rules and no conflict
resolution, competing with the Dexie layer phase 2 adds.

### Dev

Off by default. `VITE_PWA_DEV=true npm run dev` enables it. A stale cached
shell in dev is a very confusing way to lose an afternoon.

### What was already in place

`public/manifest.json` was already complete (name, icons, `standalone`,
theme colour) and already linked from `index.html`, so the plugin runs
with `manifest: false`. Registration moved from an inline call in
`main.jsx` to `src/lib/pwa.js`; the plugin runs with
`injectRegister: false` because two registrations would race.

---

## Adding a new synced table

*Phase 2/3 will fill this in properly. Recorded now so the decisions
aren't re-litigated:*

1. Add the table to the Dexie schema with a version bump — never edit an
   existing version's store definition.
2. Mirror it in the entities layer, not in components. Every one of the 46
   `useQuery` call sites goes through `createEntity`, so the local-first
   path belongs there.
3. The table needs `client_updated_at` (see below).
4. If writes to it are an **array column** rather than rows, it needs
   delta operations, not row upserts. See the next section.
5. Confirm its RLS lets the *client* upsert. Two tables do not — see
   "Known RLS blockers".

## Decisions already taken (phases 2–3)

**Check-ins are an array, not rows.** `habits.completions` is
`text[]`. There is no check-in table. So row-level last-write-wins would
*destroy* offline check-ins: two devices each log a different day, both
push the whole `habits` row, and one device's day is gone.

The outbox therefore stores **delta operations** —
`{op: "completion_add" | "completion_remove", habitId, day, at}` — which
are idempotent and commutative, so replay order cannot lose a check-in.
The `at` stamp resolves add-vs-remove of the *same* day, which set union
alone cannot.

**`updated_at` is sync time, not edit time.** `habits_set_updated_at` is a
`before update` trigger calling `now()` server-side. A check-in made
offline on Monday and pushed on Wednesday gets Wednesday's stamp, and
would beat a genuine Tuesday edit from another device. Conflict resolution
therefore needs a client-supplied `client_updated_at` that the trigger
does not touch. That column must stay **client-writable** — unlike
`rolling_best_streak_90` and `witness_slots`, which are server-derived and
guarded by `protect_user_profiles_stats_fields`.

**Streaks are already correct offline.** They are computed client-side
from `completions` (`calculateStats`, `getAllTimeBest`, `rollingBest` in
`src/lib/utils.js`). `user_profiles.best_streak` and `consistency_score`
are server-derived mirrors for *other people's* leaderboard rows, and are
already blocked from client writes. Nothing to change.

## Known RLS blockers

Flagged, not changed.

- **`freeze_assists`** and **`freeze_assist_notifications`** have
  `with check (current_user = 'freeze_rpc_trusted')`. The client cannot
  insert them at all; they go through a `SECURITY DEFINER` RPC. An offline
  "save a friend's streak" must queue **the RPC call**, not a row upsert.
  *Proposed fix: leave the policy alone and give the outbox an `rpc`
  operation type.* Relaxing the policy to allow client inserts would undo
  the reason the trusted role exists.
- **No `deleted_at` exists anywhere** — every delete is currently hard.
  Soft delete is not one column: every read path needs a
  `deleted_at is null` filter, and the `*_delete_own` policies become
  dead. *Proposed scope: habits first, not all 20 tables.*

## Known limitations

- **iOS evicts storage.** Safari clears a site's IndexedDB and Cache
  Storage when it decides space is short, and for a site that isn't
  installed to the home screen it can happen after as little as **7 days
  without a visit**. Unsynced outbox entries are lost with it. This is why
  the install prompt matters more on iOS than anywhere else, and why the
  sync engine should push eagerly rather than batching.
- **No Background Sync.** iOS does not implement it. Sync runs on app
  open, the `online` event, `visibilitychange`, after each local write
  while online, and on an interval while the app is open. Nothing syncs
  while the app is closed.
- **Phase 1 does not cache data.** Opening offline shows the shell and
  then empty/error states from the data layer.
- **Billing is online-only.** Paddle checkout cannot work offline at all.
  Phase 4 caches subscription *status* for 7 days so paid features keep
  working; the checkout flow is untouched.
- **The precache is ~62 entries and grows with the bundle.** The size
  limit is raised to 4 MiB per file because the entry chunk is ~530 KiB
  and the recharts chunk ~370 KiB; the default 2 MiB silently drops large
  chunks from the precache without failing the build, which produces a
  blank screen on a cold offline start.

## Manual verification

Neither of these can be automated here, and the build output assertions in
`pwaBuild.test.js` are not a substitute.

**Chrome DevTools**

1. `npm run build && npm run preview`, open the preview URL.
2. Application → Service Workers: confirm one worker, activated, source
   `/sw.js`.
3. Application → Cache Storage: confirm `workbox-precache-*` holds
   `index.html`, `offline.html`, `manifest.json` and the hashed assets.
4. Network → Offline. Reload. **The app shell must render.** Data areas
   will show empty/error states — expected until phase 2.
5. Navigate between tabs while offline: they must not blank out (the
   chunks are precached).
6. Clear Cache Storage, go offline, reload: `offline.html` should appear,
   and should reload itself when you go back online.
7. Deploy-update path: rebuild, reload twice, confirm you end up on the
   new assets and not a blank screen.

**A real phone in airplane mode**

1. Install to the home screen (Android: the install prompt; iOS: Share →
   Add to Home Screen).
2. Open it once online so the precache populates.
3. Airplane mode. Cold-launch from the home screen icon: the shell must
   render.
4. **Android only, the regression this phase risked:** with notifications
   enabled, trigger one and tap it. It must focus or open the app. If it
   does nothing, the `notificationclick` handler was lost.
5. Leave airplane mode and confirm the app recovers without a manual
   reload.
