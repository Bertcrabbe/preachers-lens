-- Add audio_url column to sermon_comments for audio commentary
ALTER TABLE public.sermon_comments 
ADD COLUMN audio_url TEXT;

-- Create storage bucket for audio comments
INSERT INTO storage.buckets (id, name, public)
VALUES ('sermon-comments-audio', 'sermon-comments-audio', false);

-- Create storage bucket for exported combined audio
INSERT INTO storage.buckets (id, name, public)
VALUES ('sermon-exports', 'sermon-exports', true);

-- RLS policies for sermon-comments-audio bucket
CREATE POLICY "Users can upload their own audio comments"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'sermon-comments-audio' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can view their own audio comments"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'sermon-comments-audio' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own audio comments"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'sermon-comments-audio' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- RLS policies for sermon-exports bucket
CREATE POLICY "Users can upload their own exports"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'sermon-exports' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Anyone can view exports"
ON storage.objects
FOR SELECT
USING (bucket_id = 'sermon-exports');

CREATE POLICY "Users can delete their own exports"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'sermon-exports' AND
  auth.uid()::text = (storage.foldername(name))[1]
);