
-- Create sermon_metrics table to cache computed analytics per sermon
CREATE TABLE public.sermon_metrics (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sermon_id uuid NOT NULL REFERENCES public.sermons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  engagement_score numeric,
  illustration_score numeric,
  congregation_questions integer,
  wpm integer,
  word_count integer,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(sermon_id)
);

-- Enable RLS
ALTER TABLE public.sermon_metrics ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own sermon metrics"
  ON public.sermon_metrics FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own sermon metrics"
  ON public.sermon_metrics FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sermon metrics"
  ON public.sermon_metrics FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own sermon metrics"
  ON public.sermon_metrics FOR DELETE
  USING (auth.uid() = user_id);
