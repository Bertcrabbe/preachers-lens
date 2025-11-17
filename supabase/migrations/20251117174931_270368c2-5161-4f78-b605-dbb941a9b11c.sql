-- Create evaluation_rules table
CREATE TABLE public.evaluation_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  prompt TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.evaluation_rules ENABLE ROW LEVEL SECURITY;

-- Create policies for evaluation_rules
CREATE POLICY "Users can view their own rules"
ON public.evaluation_rules
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own rules"
ON public.evaluation_rules
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own rules"
ON public.evaluation_rules
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own rules"
ON public.evaluation_rules
FOR DELETE
USING (auth.uid() = user_id);

-- Add rule_id to sermon_comments
ALTER TABLE public.sermon_comments
ADD COLUMN rule_id UUID REFERENCES public.evaluation_rules(id) ON DELETE SET NULL;

-- Create trigger for updated_at
CREATE TRIGGER update_evaluation_rules_updated_at
BEFORE UPDATE ON public.evaluation_rules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for performance
CREATE INDEX idx_evaluation_rules_user_id ON public.evaluation_rules(user_id);
CREATE INDEX idx_sermon_comments_rule_id ON public.sermon_comments(rule_id);