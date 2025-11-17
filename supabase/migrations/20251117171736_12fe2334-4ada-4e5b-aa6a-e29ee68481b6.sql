-- Create function to trigger transcription
CREATE OR REPLACE FUNCTION public.trigger_transcription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Call the transcribe-sermon edge function asynchronously
  PERFORM net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/transcribe-sermon',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := jsonb_build_object('sermonId', NEW.id)
  );
  
  RETURN NEW;
END;
$$;

-- Create trigger on sermon insert
CREATE TRIGGER on_sermon_upload
  AFTER INSERT ON public.sermons
  FOR EACH ROW
  WHEN (NEW.transcription_status = 'pending')
  EXECUTE FUNCTION public.trigger_transcription();