---
name: Digital Bert Length Clock
description: Bert's per-note length is clocked against the user's own avg/median comment word count and spoken seconds, with a hard floor at the median
type: feature
---
`ai-coach-comments/index.ts` computes the user's avg and median word count from their own past recorded comments and converts to spoken seconds (~2.5 words/sec). These are passed into the prompt as a "LENGTH TARGET — CLOCKED FROM..." block.

- **Floor:** `max(25, medWords)` words. Notes below this are rejected.
- **Ceiling:** `max(min+15, center * 1.5)` words.
- **Middle notes:** target the clocked band; usually 2-4 sentences (not one-liners).
- **Intro/outro:** 2-3× the middle length, matching the intro/outro-scope rule.

**Why:** User flagged that Bert's notes were noticeably shorter than their own. The fix is to clock against the user's actual spoken duration rather than a fixed band, and to remove the older "1-3 sentence surgical" guidance that was pulling Bert short.
