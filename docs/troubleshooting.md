# Troubleshooting

## Supabase Type Errors

**Symptom:** TypeScript errors referencing `src/integrations/supabase/types.ts`, or properties missing from table row types.

**Fix:** Regenerate the types file from the live schema using the Supabase CLI:

```bash
supabase gen types typescript --project-id <your-project-id> > src/integrations/supabase/types.ts
```

Never edit `types.ts` by hand — it will be overwritten the next time types are regenerated.

## Auth Not Persisting / Redirect Loops

**Symptom:** User is redirected to `/auth` on every page load, or the session disappears after refresh.

**Fix:** Check that the Supabase client in `src/integrations/supabase/client.ts` is initialised with `persistSession: true` and `autoRefreshToken: true`. Also verify `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set correctly in `.env` — a wrong URL causes all auth calls to silently fail.

## Edge Function Errors (400 / 500 from `/functions/v1/...`)

**Symptom:** A call to `supabase.functions.invoke(...)` returns an error object or non-2xx status.

**Fix:**
1. Open the Supabase dashboard → Edge Functions → select the function → Logs.
2. Check for missing environment variables — secrets set in Supabase project settings are not automatically available locally. Run `supabase secrets set KEY=value` to sync them.
3. For `401 Unauthorized`, ensure the function is not called before the user session is established, so the client attaches a valid JWT.

## AI Analysis Returns No Results

**Symptom:** `evaluate-sermon`, `analyze-emotional-resonance`, or similar functions complete without creating any comments or metrics.

**Fix:**
- Confirm `LOVABLE_API_KEY` is set in Supabase project secrets.
- The Lovable AI Gateway returns `429` (rate limit) or `402` (payment required) on quota exhaustion — check function logs for these status codes.
- Verify the sermon has a completed transcription (`transcription_status = 'completed'` in the `sermons` table) before running analysis functions.

## Transcription Stuck in `processing`

**Symptom:** A sermon's `transcription_status` stays on `processing` and never moves to `completed` or `failed`.

**Fix:**
1. Check the `transcribe-sermon` edge function logs for AssemblyAI API errors.
2. Verify `ASSEMBLYAI_API_KEY` is set in Supabase secrets.
3. AssemblyAI requires the audio file to be publicly accessible. Ensure the file URL in Supabase Storage has a valid signed or public URL.

## Audio Not Recording / Microphone Access Denied

**Symptom:** The audio recorder shows no input, or the browser never prompts for microphone access.

**Fix:** The app uses `navigator.mediaDevices.getUserMedia`. This API requires HTTPS in production. In local development, `localhost` is treated as secure. If running on a non-localhost IP (e.g., `0.0.0.0:8080`), the browser will block microphone access — access the app via `http://localhost:8080` instead.

## Vite Dev Server Port Conflicts

**Symptom:** `npm run dev` fails with `address already in use`.

**Fix:** The dev server is configured for port 8080 in `vite.config.ts`. Kill the process on that port or temporarily change the port in `vite.config.ts`.

## Common Agent Mistakes

- **Wrong import paths:** Use `@/` for all imports within `src/`. Never use deep relative paths like `../../../components`.
- **Editing generated files:** Never edit `src/integrations/supabase/types.ts` directly. It is overwritten by `supabase gen types`.
- **Node.js APIs in edge functions:** Edge functions run on Deno. Do not use `require()`, Node.js built-ins, or npm packages without the `npm:` prefix.
- **Non-null assertions:** Use `?.` or an explicit guard check instead of `!.` — the linter forbids non-null assertions.
- **Using `.single()` for optional rows:** `.single()` throws when no row is found. Use `.maybeSingle()` for rows that may not exist.
