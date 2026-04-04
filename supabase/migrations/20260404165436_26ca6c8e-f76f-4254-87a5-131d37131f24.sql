CREATE POLICY "Users can update sentences of their own sermons"
ON public.sermon_sentences
FOR UPDATE
TO public
USING (EXISTS (
  SELECT 1 FROM sermons
  WHERE sermons.id = sermon_sentences.sermon_id
    AND sermons.user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM sermons
  WHERE sermons.id = sermon_sentences.sermon_id
    AND sermons.user_id = auth.uid()
));