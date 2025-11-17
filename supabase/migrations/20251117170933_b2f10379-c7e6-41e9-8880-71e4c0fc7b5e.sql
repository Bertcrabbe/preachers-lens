-- Create sermons table
CREATE TABLE public.sermons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT,
  file_url TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'audio',
  transcription_status TEXT NOT NULL DEFAULT 'pending' CHECK (transcription_status IN ('pending', 'processing', 'completed', 'failed')),
  duration_seconds INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create sermon_sentences table
CREATE TABLE public.sermon_sentences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sermon_id UUID NOT NULL REFERENCES public.sermons(id) ON DELETE CASCADE,
  start_time_ms INTEGER NOT NULL,
  end_time_ms INTEGER NOT NULL,
  sentence_text TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create index for faster sentence queries
CREATE INDEX idx_sermon_sentences_sermon_id ON public.sermon_sentences(sermon_id);
CREATE INDEX idx_sermon_sentences_order ON public.sermon_sentences(sermon_id, order_index);

-- Enable RLS
ALTER TABLE public.sermons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sermon_sentences ENABLE ROW LEVEL SECURITY;

-- RLS Policies for sermons table
CREATE POLICY "Users can view their own sermons"
  ON public.sermons
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own sermons"
  ON public.sermons
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sermons"
  ON public.sermons
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own sermons"
  ON public.sermons
  FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for sermon_sentences table
CREATE POLICY "Users can view sentences of their own sermons"
  ON public.sermon_sentences
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sermons
      WHERE sermons.id = sermon_sentences.sermon_id
      AND sermons.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert sentences for their own sermons"
  ON public.sermon_sentences
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sermons
      WHERE sermons.id = sermon_sentences.sermon_id
      AND sermons.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete sentences of their own sermons"
  ON public.sermon_sentences
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.sermons
      WHERE sermons.id = sermon_sentences.sermon_id
      AND sermons.user_id = auth.uid()
    )
  );

-- Create storage bucket for sermons
INSERT INTO storage.buckets (id, name, public) VALUES ('sermons', 'sermons', false);

-- RLS Policies for storage
CREATE POLICY "Users can upload their own sermon files"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'sermons' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can view their own sermon files"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'sermons' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can delete their own sermon files"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'sermons' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_sermons_updated_at
  BEFORE UPDATE ON public.sermons
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();