---
name: Digital Bert Comment Anchor Placement
description: Quote-reacting comments must anchor to the sentence AFTER the quoted line so playback fires once the listener has heard it
type: feature
---
When a Digital Bert middle note quotes or reacts to a specific line from the sermon, the `sentence_index` MUST anchor to the sentence IMMEDIATELY AFTER the quoted line — not the quoted line itself.

**Why:** Comments play back inline during sermon listening. If the comment is anchored to the same sentence as the quoted line (or earlier), the listener hears the AI's reaction BEFORE the speaker delivers the line being reacted to. That ruins the experience — like a movie spoiler.

**Correct flow:** Speaker delivers heavy line at sentence #42 → reaction comment is anchored to #43 → listener hears the line, then the reaction.

**ONE EXCEPTION:** Setup/foreshadowing comments may anchor BEFORE the line, but ONLY if the text explicitly cues the listener that something is coming next:
- "Listen to what you're about to say here…"
- "Watch this next move."
- "Here it comes — pay attention to how you land this."

Default behavior is always anchor-after-the-quote.

**How to apply:** Enforced in two places inside the COACH VOICE CHARTER + per-note instructions in `supabase/functions/ai-coach-comments/index.ts` (COMMENT ANCHOR PLACEMENT block + ANCHOR-AFTER-QUOTE RULE bullet).
