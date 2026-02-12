
-- Drop the policies without trailing space (these already exist as permissive duplicates)
DROP POLICY IF EXISTS "Users can view their own communicators" ON public.communicators;
DROP POLICY IF EXISTS "Users can create their own communicators" ON public.communicators;
DROP POLICY IF EXISTS "Users can update their own communicators" ON public.communicators;
DROP POLICY IF EXISTS "Users can delete their own communicators" ON public.communicators;

-- Drop the restrictive ones (with trailing space in name)
DROP POLICY IF EXISTS "Users can view their own communicators " ON public.communicators;
DROP POLICY IF EXISTS "Users can create their own communicators " ON public.communicators;
DROP POLICY IF EXISTS "Users can update their own communicators " ON public.communicators;
DROP POLICY IF EXISTS "Users can delete their own communicators " ON public.communicators;

-- Recreate as PERMISSIVE
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

-- Same for sermons
DROP POLICY IF EXISTS "Users can view their own sermons" ON public.sermons;
DROP POLICY IF EXISTS "Users can create their own sermons" ON public.sermons;
DROP POLICY IF EXISTS "Users can update their own sermons" ON public.sermons;
DROP POLICY IF EXISTS "Users can delete their own sermons" ON public.sermons;
DROP POLICY IF EXISTS "Users can view their own sermons " ON public.sermons;
DROP POLICY IF EXISTS "Users can create their own sermons " ON public.sermons;
DROP POLICY IF EXISTS "Users can update their own sermons " ON public.sermons;
DROP POLICY IF EXISTS "Users can delete their own sermons " ON public.sermons;

CREATE POLICY "Users can view their own sermons"
  ON public.sermons FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own sermons"
  ON public.sermons FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sermons"
  ON public.sermons FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own sermons"
  ON public.sermons FOR DELETE
  USING (auth.uid() = user_id);
