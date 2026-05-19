CREATE TABLE public.coach_style_guides (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  guide_text text NOT NULL DEFAULT '',
  comments_analyzed integer NOT NULL DEFAULT 0,
  last_analyzed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.coach_style_guides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own style guide"
  ON public.coach_style_guides FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own style guide"
  ON public.coach_style_guides FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own style guide"
  ON public.coach_style_guides FOR UPDATE
  USING (auth.uid() = user_id);

CREATE TRIGGER coach_style_guides_set_updated_at
  BEFORE UPDATE ON public.coach_style_guides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();