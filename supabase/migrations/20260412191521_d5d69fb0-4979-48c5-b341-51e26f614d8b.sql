CREATE POLICY "Users can update their own sermon files"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'sermons' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'sermons' AND (storage.foldername(name))[1] = auth.uid()::text);