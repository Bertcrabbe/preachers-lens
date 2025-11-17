-- Drop the trigger and function that's causing issues
DROP TRIGGER IF EXISTS on_sermon_upload ON public.sermons;
DROP FUNCTION IF EXISTS public.trigger_transcription();