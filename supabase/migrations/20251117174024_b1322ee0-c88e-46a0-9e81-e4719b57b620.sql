-- Create comments table for sermon sentences and paragraphs
CREATE TABLE public.sermon_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sermon_id UUID NOT NULL REFERENCES public.sermons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  start_time_ms INTEGER NOT NULL,
  end_time_ms INTEGER NOT NULL,
  comment_text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.sermon_comments ENABLE ROW LEVEL SECURITY;

-- Users can view comments on their own sermons
CREATE POLICY "Users can view comments on their own sermons"
ON public.sermon_comments
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.sermons
    WHERE sermons.id = sermon_comments.sermon_id
    AND sermons.user_id = auth.uid()
  )
);

-- Users can create comments on their own sermons
CREATE POLICY "Users can create comments on their own sermons"
ON public.sermon_comments
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.sermons
    WHERE sermons.id = sermon_comments.sermon_id
    AND sermons.user_id = auth.uid()
  )
  AND auth.uid() = user_id
);

-- Users can update their own comments
CREATE POLICY "Users can update their own comments"
ON public.sermon_comments
FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own comments
CREATE POLICY "Users can delete their own comments"
ON public.sermon_comments
FOR DELETE
USING (auth.uid() = user_id);

-- Create trigger for updated_at
CREATE TRIGGER update_sermon_comments_updated_at
BEFORE UPDATE ON public.sermon_comments
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster queries
CREATE INDEX idx_sermon_comments_sermon_id ON public.sermon_comments(sermon_id);
CREATE INDEX idx_sermon_comments_time_range ON public.sermon_comments(start_time_ms, end_time_ms);