
CREATE TABLE public.sermon_highlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sermon_id UUID NOT NULL REFERENCES public.sermons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sentence_index INTEGER NOT NULL,
  color TEXT NOT NULL DEFAULT '#fbbf24',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.sermon_highlights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own highlights"
  ON public.sermon_highlights
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE UNIQUE INDEX idx_sermon_highlights_unique ON public.sermon_highlights (sermon_id, user_id, sentence_index);
