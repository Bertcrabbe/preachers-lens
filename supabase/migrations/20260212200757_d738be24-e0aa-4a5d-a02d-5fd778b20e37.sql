
CREATE TABLE public.communicator_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  communicator_id UUID NOT NULL REFERENCES public.communicators(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.communicator_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own communicator links"
  ON public.communicator_links FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own communicator links"
  ON public.communicator_links FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own communicator links"
  ON public.communicator_links FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own communicator links"
  ON public.communicator_links FOR UPDATE
  USING (auth.uid() = user_id);
