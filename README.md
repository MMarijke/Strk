**Strk**

**About**

A habit-tracking app, originally scaffolded on Base44, now fully migrated to a standalone Supabase backend (auth, database, realtime).

**Local setup**

1. Clone the repository and `cd` into the project directory.
2. Install dependencies: `npm install`
3. Create an `.env.local` file with:

```
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

4. Apply the SQL migrations in `supabase/migrations/` to your Supabase project (via `supabase db push` with the Supabase CLI, or by pasting each file into the SQL editor in order).
5. Run the app: `npm run dev`

**Notes**

- Sign-in uses Supabase's passwordless magic-link email flow (`src/pages/Login.jsx`).
- `base44/entities/*.jsonc` is kept only as historical reference for the original schema each Supabase table in `supabase/migrations/` was ported from — it is not read by the running app.
- `public/manifest.json` has an empty `icons` array — add real branded PWA icons before shipping.

**Docs**

- Supabase: https://supabase.com/docs