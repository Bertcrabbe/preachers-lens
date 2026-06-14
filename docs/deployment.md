# Deployment

## Environment Matrix

| Environment | Frontend | Backend | When Used |
|-------------|----------|---------|-----------|
| Production | Lovable (main branch auto-deploy) | Supabase production project | Live users |
| Preview | Lovable preview deployment | Supabase production project | Pull requests |
| Development | localhost:8080 (Vite dev server) | Supabase production project (shared) | Local development |
| Feature VM | exe.dev VM on port 8080 | Supabase production project | Isolated feature work |

## Production Deploy

1. Merge PR to `main` branch.
2. Lovable automatically builds and deploys the frontend.
3. Supabase edge functions are deployed separately via the Supabase CLI or Supabase dashboard.

Database migrations must be applied manually via the Supabase dashboard or `supabase db push` before deploying code that depends on schema changes.

## Preview Deploys

When a pull request is opened, Lovable creates a preview deployment from the branch. All preview deployments share the same Supabase project as production — there is no isolated preview database. Test with non-critical data.

## Required Environment Variables

### Frontend (set in `.env` for local dev; in Lovable project settings for deployed environments)

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL (e.g. `https://<ref>.supabase.co`) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/public key |

### Edge Functions (set via `supabase secrets set` or the Supabase dashboard)

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Project URL (auto-available in edge functions) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key for admin DB access in edge functions |
| `ASSEMBLYAI_API_KEY` | AssemblyAI transcription API key |
| `LOVABLE_API_KEY` | Lovable AI Gateway key (Gemini models) |
| `ELEVENLABS_API_KEY` | ElevenLabs voice synthesis key |

## First-Time Setup

1. Clone the repository:
   ```bash
   git clone <repo-url> preachers-lens
   cd preachers-lens
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create your environment file:
   ```bash
   cp .env.example .env
   ```

4. Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the Supabase dashboard (Project Settings → API).

5. Start the development server:
   ```bash
   npm run dev
   ```
   The app runs at `http://localhost:8080`.

## Deploying Edge Functions

Deploy all edge functions to the Supabase project:

```bash
supabase functions deploy
```

Deploy a single function:

```bash
supabase functions deploy transcribe-sermon
```

Set secrets for edge functions:

```bash
supabase secrets set ASSEMBLYAI_API_KEY=<key> LOVABLE_API_KEY=<key> ELEVENLABS_API_KEY=<key>
```

## Pre-PR Validation

Before opening a pull request, run:

```bash
npm run harness:pre-pr
```

This runs the production build, ESLint, type checking, tests, and the risk-tier assessment in sequence.
