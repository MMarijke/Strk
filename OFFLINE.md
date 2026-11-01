# Offline support

Status: **all four phases shipped.** Habits work offline end to end.

| phase | what | state |
|---|---|---|
| 1 | PWA shell: precached assets, offline fallback, install prompt | **done** |
| 2 | Dexie mirror + read-through at the entities layer | **done** |
| 3 | Outbox + sync engine | **done** |
| 4 | Subscription status caching | **done** |

What works with no network: the app loads, habit data renders, and habits
can be created, edited, deleted and checked in. Writes queue and replay
when connectivity returns.

A Pro user keeps their paid features offline, for up to a week — see
"Trusting a cached plan" below.

What does not: anything social (groups, challenges, focus sessions,
reactions, partnerships) still reaches Supabase and still shows an empty
or error state offline — deliberately, see "Which tables" below. Paddle
checkout is online-only and always will be.

The sync status indicator shipped early, with phase 3 rather than 4: the
outbox parks an entry as failed after six attempts, and without somewhere
for that to show, a check-in that never reached the server looks exactly
like one that did.

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

## How it fits together

```
component  ->  useQuery / mutation          (unchanged, 46 call sites)
               src/api/entities.js          read-through
               lib/offline/localStore.js    optimistic write + enqueue
               lib/offline/outbox.js        the queue
               lib/offline/sync.js          push, pull, triggers
               lib/offline/db.js            Dexie: mirrors, outbox, meta
```

The local path lives **inside `createEntity`**, not in the components.
Every one of the 46 `useQuery` call sites already goes through
`list/filter/create/update/delete`, so reads come from IndexedDB and
writes become optimistic without touching a single component — and the
`invalidateQueries` logic already threaded through every mutation path
stays the reactivity mechanism.

This is why the brief's "the UI reads only from Dexie via live queries"
was not followed literally: `liveQuery` would mean rewriting all 46 sites
and discarding that invalidation work. The trade-off is that cross-tab
reactivity is not automatic — a second tab sees changes on its next query
or sync rather than instantly.

**Reads fall back to the network when the local store is empty.** An empty
mirror means "never synced", not "no data", so reporting nothing on a
first-ever load would be wrong. Once populated, local is authoritative.

## Which tables

Opt-in, in `lib/offline/tables.js`. Two tables:

| table | read | write |
|---|---|---|
| `habits` | yes | yes |
| `user_profiles` | yes | no |

Mirroring all twenty would be wrong. Groups, challenges, focus sessions,
reactions and nudges are inherently multi-party — a cached "who is in this
focus session right now" is worse than an honest empty state — and
several reject client writes outright (see Known RLS blockers).

`user_profiles` is read-cached but not writable offline: its interesting
columns (`best_streak`, `rolling_best_streak_90`, `consistency_score`,
`witness_slots`) are server-derived and already blocked from client writes
by `protect_user_profiles_stats_fields`, so an offline write to them would
produce an outbox entry that can only ever fail. It is cached because
Dashboard, Badges and Social all read it on mount and without it the shell
renders with no score, tier or name.

## Adding a new synced table

1. Add it to `OFFLINE_TABLES` in `lib/offline/tables.js` with `read`,
   `write`, `ownerColumn`, and `setColumns`.
2. Add the store to the Dexie schema in `db.js` **with a version bump** —
   never edit an existing version's definition.
3. Add it to `clearLocalData()`, or signing out leaves its rows behind for
   the next user on that device.
4. If it has an **array column** written by adding and removing members
   rather than replacing the value, list it in `setColumns`. Getting this
   wrong is the check-in data loss described below.
5. If it needs column defaults on an optimistic insert, add them to
   `LOCAL_INSERT_DEFAULTS` in `entities.js` — otherwise the local row is
   missing them until the first sync.
6. Confirm its RLS lets the *client* upsert. Two tables do not.

## The two decisions that shaped the engine

**Check-ins are an array, not rows.** `habits.completions` is
`text[]`. There is no check-in table. So row-level last-write-wins would
*destroy* offline check-ins: two devices each log a different day, both
push the whole `habits` row, and one device's day is gone.

The outbox therefore stores **delta operations** per member —
`{op: "set_add" | "set_remove", table, rowId, column, member}` — which
are idempotent (adding a day twice is the same set) and commutative
(replay order does not matter), so nothing is lost however two devices
interleave. `queueUpdate` derives them by diffing the new array against
the local row's previous value, which is why that previous row is a
required argument rather than an optional one: without it the only
fallback is the whole-array patch this exists to avoid.

Push does a read-modify-write against Supabase and then **verifies the
member actually landed**, re-throwing if not, so an interleaved
concurrent write is retried instead of silently dropped. The generic
names are deliberate: the mechanism is `setColumns` in
`lib/offline/tables.js`, not a hard-coded `completions`, so the next
array column needs a config entry rather than new operations.

Two residual gaps, both named in the code at the line that would be
wrong: the read-modify-write race above is narrowed by the verify but
not eliminated (an atomic `habit_completion_add` RPC is proposed in
`docs/proposed/`), and add-vs-remove of the *same* day across two
devices has no tiebreak — set union alone cannot express it, and the
`at` stamp that would resolve it was dropped because ordering it
correctly needs `client_updated_at`, which is proposed and not applied.

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

## Trusting a cached plan

`plan` is the column the whole paid tier hangs off, and it is the one
piece of cached state where both answers are wrong:

- Refusing to trust it offline downgrades a paying customer the moment
  their train enters a tunnel.
- Trusting it forever hands out Pro to a lapsed subscriber on a device
  that simply never reconnects.

So: **online, the server is authoritative** — `useSubscription` passes
`{ fresh: true }`, which skips the mirror, because the Paddle webhook
flips `plan` server-side and a customer who has just checked out must
not still be told they are on free. **Offline, the cached plan is
honoured for seven days** from the last *successful* profile pull, then
stops.

Three details that matter more than they look:

1. **The clock is the sync time, not the row time.** `meta` holds a
   `syncedAt:<table>` written at the end of a pull that completed,
   including one that merged nothing — "we asked and there was nothing
   new" is exactly what makes the mirror fresh. The cursor cannot serve
   here: it tracks the newest row's `updated_at` and does not move when
   a pull returns nothing. A pull that *failed* writes neither.
2. **A verified answer is never dated by the mirror.** They are separate
   branches in the hook on purpose. Dating a live server answer by the
   mirror's last pull would downgrade a paying user whose profile mirror
   had not synced yet, since no stamp fails closed — the exact failure
   the whole design is meant to prevent.
3. **It fails closed, except on a clock going backwards.** No stamp, or
   an unparseable one, refuses a cached `pro`. A stamp in the *future* is
   clamped to fresh instead: a wrong device clock must not cancel
   somebody's subscription.

When a cached plan does lapse, Settings says so in as many words
(`isSubscriptionExpired`), because the alternative is a paying customer
discovering it by tapping a feature that has quietly stopped working.

The seven days are deliberately generous. The failure it permits — one
device keeps Pro for a week after a cancellation, while offline — is far
cheaper than the one it prevents.

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
- **Only habits are cached.** Everything social reaches the network and
  shows an empty or error state offline. See "Which tables".
- **Cross-tab updates are not instant.** The read-through sits in
  `entities.js` rather than in `liveQuery`, so a second tab picks up a
  change on its next query or sync, not immediately.
- **A write that cannot ever succeed parks after six attempts.** The
  local row keeps the change and `SyncStatus` offers Retry, but nothing
  escalates it further — an RLS rejection looks the same to the outbox
  as a dropped connection.
- **Checkout is online-only.** Paddle cannot work offline at all. Paid
  *status* is cached for seven days (above); buying, upgrading and
  cancelling all need a connection.
- **A device offline for more than a week loses Pro until it
  reconnects.** By design, and said plainly in Settings when it
  happens.
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
4. Network → Offline. Reload. **The app shell and your habits must
   render.** Social areas will show empty/error states — expected.
5. Navigate between tabs while offline: they must not blank out (the
   chunks are precached).
6. Clear Cache Storage, go offline, reload: `offline.html` should appear,
   and should reload itself when you go back online.
7. Deploy-update path: rebuild, reload twice, confirm you end up on the
   new assets and not a blank screen.

**Chrome DevTools — the data layer**

Signed in, online, with at least two habits. Application → IndexedDB →
`strk-offline` is the mirror; `outbox` is the queue.

8. Online, load Dashboard. Confirm `habits` holds your rows and
   `user_profiles` holds yours. An empty `habits` store means the pull
   never ran — check the console, not the UI.
9. Network → Offline. Reload. Habits must render from the mirror, and a
   quiet "Offline — your habits still work" line must appear above the
   page.
10. Still offline: check in on a habit. The ring/count must update
    immediately with no spinner, and `outbox` must gain one `set_add`
    row with `status: "pending"`. The status line changes to "1 change
    will sync later".
11. Still offline: create a habit, rename it, delete another. Confirm an
    `insert`, a `patch` and a `delete` queue in that order and that `seq`
    is ascending — order is what keeps a patch from targeting a row the
    server has not seen yet.
12. Go back online without reloading. The outbox must drain to empty
    within a few seconds and the status line must disappear. Reload and
    confirm the server agreed: the check-in, the new habit, the rename
    and the deletion all survive.
13. **The one that matters — two devices, no lost check-in.** Open the
    app in a second profile/window signed in as the same user. Take both
    offline. Check in on *different* days in each (or different habits).
    Bring both online. **Both check-ins must be present.** If one is
    gone, a whole-array patch got queued somewhere instead of a
    `set_add`.
14. Failure surfacing: while offline, queue a write, then in DevTools set
    the `outbox` row's `status` to `"failed"` and reload. A "1 change
    didn't save" card with a Retry button must appear. Retry must clear
    it once online.
15. **Paid status.** As a Pro user, go offline and reload: Pro features
    must still work and Settings must still say "Pro Plan". Then, in
    DevTools, change `meta` → `syncedAt:user_profiles` to a date more
    than seven days old and reload while still offline: the plan must
    drop to Free *and* the Subscription card must explain why. Back
    online, it must return on the next load with no action from the
    user.
16. Sign out. `habits`, `user_profiles` and `outbox` must all be empty —
    a shared device must not leak the previous user's habits. Sign in as
    a different user and confirm the mirror repopulates with *their*
    rows.

Expected to fail, by design: anything social offline (groups,
challenges, focus sessions) and Paddle checkout.

**A real phone in airplane mode**

1. Install to the home screen (Android: the install prompt; iOS: Share →
   Add to Home Screen).
2. Open it once online so the precache populates.
3. Airplane mode. Cold-launch from the home screen icon: the shell must
   render.
4. **Android only, the regression this phase risked:** with notifications
   enabled, trigger one and tap it. It must focus or open the app. If it
   does nothing, the `notificationclick` handler was lost.
5. In airplane mode, check in on a habit and create one. Both must apply
   instantly, and the offline line must count the pending changes.
6. Leave airplane mode and confirm the app recovers without a manual
   reload: the pending count clears on its own.
7. Force-quit the app while still in airplane mode with changes pending,
   then relaunch (still offline). The changes must still be there — the
   outbox is on disk, not in memory — and must drain when connectivity
   returns.
8. **iOS specifically:** do this from the home-screen icon, not Safari.
   An uninstalled site can have its IndexedDB evicted after ~7 days
   without a visit, taking pending writes with it.
