-- Create communicators table
CREATE TABLE public.communicators (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.communicators ENABLE ROW LEVEL SECURITY;

-- RLS policies for communicators
CREATE POLICY "Users can view their own communicators"
ON public.communicators FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own communicators"
ON public.communicators FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own communicators"
ON public.communicators FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own communicators"
ON public.communicators FOR DELETE
USING (auth.uid() = user_id);

-- Add trigger for updated_at
CREATE TRIGGER update_communicators_updated_at
BEFORE UPDATE ON public.communicators
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add communicator_id to sermons table (nullable to support existing sermons)
ALTER TABLE public.sermons 
ADD COLUMN communicator_id UUID REFERENCES public.communicators(id) ON DELETE SET NULL;