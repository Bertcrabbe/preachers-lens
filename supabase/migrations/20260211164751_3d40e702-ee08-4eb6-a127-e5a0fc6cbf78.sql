
-- Drop the restrictive policies and recreate as permissive
DROP POLICY IF EXISTS "Users can view their own communicators" ON public.communicators;
DROP POLICY IF EXISTS "Users can create their own communicators" ON public.communicators;
DROP POLICY IF EXISTS "Users can update their own communicators" ON public.communicators;
DROP POLICY IF EXISTS "Users can delete their own communicators" ON public.communicators;

CREATE POLICY "Users can view their own communicators" ON public.communicators FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own communicators" ON public.communicators FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own communicators" ON public.communicators FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own communicators" ON public.communicators FOR DELETE USING (auth.uid() = user_id);

-- Also fix sermons table which has the same issue
DROP POLICY IF EXISTS "Users can view their own sermons" ON public.sermons;
DROP POLICY IF EXISTS "Users can create their own sermons" ON public.sermons;
DROP POLICY IF EXISTS "Users can update their own sermons" ON public.sermons;
DROP POLICY IF EXISTS "Users can delete their own sermons" ON public.sermons;

CREATE POLICY "Users can view their own sermons" ON public.sermons FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own sermons" ON public.sermons FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own sermons" ON public.sermons FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own sermons" ON public.sermons FOR DELETE USING (auth.uid() = user_id);

-- Fix evaluation_rules too
DROP POLICY IF EXISTS "Users can view their own rules" ON public.evaluation_rules;
DROP POLICY IF EXISTS "Users can create their own rules" ON public.evaluation_rules;
DROP POLICY IF EXISTS "Users can update their own rules" ON public.evaluation_rules;
DROP POLICY IF EXISTS "Users can delete their own rules" ON public.evaluation_rules;

CREATE POLICY "Users can view their own rules" ON public.evaluation_rules FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own rules" ON public.evaluation_rules FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own rules" ON public.evaluation_rules FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own rules" ON public.evaluation_rules FOR DELETE USING (auth.uid() = user_id);

-- Fix sermon_sentences
DROP POLICY IF EXISTS "Users can view sentences of their own sermons" ON public.sermon_sentences;
DROP POLICY IF EXISTS "Users can insert sentences for their own sermons" ON public.sermon_sentences;
DROP POLICY IF EXISTS "Users can delete sentences of their own sermons" ON public.sermon_sentences;

CREATE POLICY "Users can view sentences of their own sermons" ON public.sermon_sentences FOR SELECT USING (EXISTS (SELECT 1 FROM sermons WHERE sermons.id = sermon_sentences.sermon_id AND sermons.user_id = auth.uid()));
CREATE POLICY "Users can insert sentences for their own sermons" ON public.sermon_sentences FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM sermons WHERE sermons.id = sermon_sentences.sermon_id AND sermons.user_id = auth.uid()));
CREATE POLICY "Users can delete sentences of their own sermons" ON public.sermon_sentences FOR DELETE USING (EXISTS (SELECT 1 FROM sermons WHERE sermons.id = sermon_sentences.sermon_id AND sermons.user_id = auth.uid()));

-- Fix sermon_comments
DROP POLICY IF EXISTS "Users can view comments on their own sermons" ON public.sermon_comments;
DROP POLICY IF EXISTS "Users can create comments on their own sermons" ON public.sermon_comments;
DROP POLICY IF EXISTS "Users can update their own comments" ON public.sermon_comments;
DROP POLICY IF EXISTS "Users can delete their own comments" ON public.sermon_comments;

CREATE POLICY "Users can view comments on their own sermons" ON public.sermon_comments FOR SELECT USING (EXISTS (SELECT 1 FROM sermons WHERE sermons.id = sermon_comments.sermon_id AND sermons.user_id = auth.uid()));
CREATE POLICY "Users can create comments on their own sermons" ON public.sermon_comments FOR INSERT WITH CHECK ((EXISTS (SELECT 1 FROM sermons WHERE sermons.id = sermon_comments.sermon_id AND sermons.user_id = auth.uid())) AND (auth.uid() = user_id));
CREATE POLICY "Users can update their own comments" ON public.sermon_comments FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own comments" ON public.sermon_comments FOR DELETE USING (auth.uid() = user_id);
