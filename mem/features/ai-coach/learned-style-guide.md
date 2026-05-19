---
name: Digital Bert Auto-Learned Style Guide
description: Weekly Sunday-night job distills the user's own comments into a personalized style guide that Bert reads on every generation
type: feature
---
Digital Bert maintains a per-user "living style guide" in the `coach_style_guides` table (one row per user, RLS: owner-only select/insert/update; no delete).

**Pipeline:**
1. `pg_cron` job `weekly-learn-coach-style` runs every Sunday at 03:00 UTC.
2. It POSTs `{"mode":"all"}` to the `learn-coach-style` edge function.
3. The function finds every user_id with non-rule comments, then for each one fetches up to 600 of their most recent comments (excluding `[AI Coach]` prefixed text and `rule_id IS NOT NULL` rows) and sends them to `google/gemini-2.5-pro` to distill a markdown style guide (max ~6000 chars) covering: what he praises, what he flags, openers, signature phrases, phrases to avoid, recurring observation patterns, tone & cadence.
4. The guide is upserted with `comments_analyzed` and `last_analyzed_at`.

**Consumption:** `ai-coach-comments` fetches the owner's guide on every generation and prepends it to the prompt BEFORE the hardcoded voice charter, treating learned observations as supplemental/overriding when specific.

**User UI:** SermonViewer's Digital Bert panel shows last-learned timestamp + comment count, plus a "Re-learn from my comments" button that calls `learn-coach-style` with `{"mode":"self"}` for an instant refresh. Requires ≥5 own comments to run.
