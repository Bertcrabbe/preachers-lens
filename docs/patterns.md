# Patterns and Conventions

## Data Fetching with Supabase

Fetch data directly from the Supabase client inside components or custom hooks. For data that multiple components need, lift the fetch into a shared hook or a React Context provider.

```tsx
import { supabase } from "@/integrations/supabase/client";

const { data, error } = await supabase
  .from("sermons")
  .select("*")
  .eq("user_id", userId)
  .order("created_at", { ascending: false });
```

Use `.maybeSingle()` instead of `.single()` when the row may not exist — `.single()` throws if no row is found.

## Real-Time Subscriptions

Use Supabase Realtime channels to watch for status changes rather than polling manually.

```tsx
useEffect(() => {
  const channel = supabase
    .channel(`sermon-${sermonId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "sermons", filter: `id=eq.${sermonId}` },
      (payload) => setSermon(payload.new as Sermon),
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}, [sermonId]);
```

## Client Routes

React Router v6 handles all navigation. Routes are defined in `src/main.tsx` (or the top-level router file). There are no server-rendered routes.

| Path | Component | Notes |
|------|-----------|-------|
| `/` | `Index` | Public landing page |
| `/auth` | `Auth` | Login / signup / password recovery |
| `/dashboard` | `Dashboard` | Sermon list, protected |
| `/sermon/:id` | `SermonViewer` | Full analysis view, protected |
| `/rules` | `Rules` | Custom evaluation rules, protected |
| `/communicator/:id/trends` | `CommunicatorTrends` | Speaker analytics, protected |
| `/compare` | `CompareSpeakers` | Multi-speaker comparison, protected |

## Calling Edge Functions

Call Supabase edge functions through the Supabase client to attach the user's JWT automatically.

```tsx
const { data, error } = await supabase.functions.invoke("transcribe-sermon", {
  body: { sermonId },
});
```

For long-running jobs, invoke the function (which returns quickly) then subscribe to the relevant row for status updates rather than awaiting a long response.

## Form Handling

Use React Hook Form with Zod validation for all forms.

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const schema = z.object({ name: z.string().min(1) });

const form = useForm({ resolver: zodResolver(schema) });
```

## Audio Processing

Heavy audio work runs in Web Workers to avoid blocking the main thread:

- `src/utils/mp3EncoderWorker.ts` — in-browser MP3 encoding via LAMEjs
- `src/utils/waveformWorker.ts` — waveform data extraction for visualisation
- `src/utils/concatRecordingsToMp3.ts` — sequential MP3 concatenation
- `src/utils/audioCombiner.ts` — merging multiple audio tracks

## Coding Style

- **Indentation**: tabs (not spaces)
- **Quotes**: double quotes
- **Trailing commas**: always in multi-line structures
- **Semicolons**: always
- No non-null assertions (`!.`) — use optional chaining (`?.`) or guard checks
- No unused variables or imports
- No explicit `any` types — use `unknown` and narrow

## Import Structure

- `@/*` — resolves to `./src/` (configured in `vite.config.ts`)
- `@/components/ui` — shadcn/ui primitive components
- `@/integrations/supabase/client` — the shared Supabase client instance

## Testing Patterns

- Use factories from `__tests__/factories/` to create test data.
- Mock the Supabase client in unit tests — never connect to a live Supabase project in tests.
- Component tests use the render helper from `__tests__/utils/render.tsx`.
- Prefer `describe` / `it` blocks with clear descriptions; one assertion per test where practical.
