import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type YoutubeResponse = {
  success: boolean;
  status?: 'completed' | 'converting';
  fallback?: boolean;
  error?: string;
  title?: string;
  sermonId?: string;
};

function jsonResponse(body: YoutubeResponse, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&?\s]+)/,
    /youtube\.com\/watch\?.*v=([^&?\s]+)/,
    /youtube\.com\/shorts\/([^&?\s]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function fetchYouTubeTitle(videoId: string): Promise<string | null> {
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
    const response = await fetch(oembedUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data?.title === 'string' ? data.title : null;
  } catch {
    return null;
  }
}

// Quick attempt at vevioz - returns download URL or null after limited attempts
async function quickVeviozAttempt(
  videoId: string,
  rapidApiKey: string,
  maxAttempts = 8
): Promise<{ downloadUrl: string } | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(`https://youtube-mp36.p.rapidapi.com/dl?id=${videoId}`, {
        headers: {
          'X-RapidAPI-Key': rapidApiKey,
          'X-RapidAPI-Host': 'youtube-mp36.p.rapidapi.com',
        },
      });
      if (!response.ok) {
        await response.text();
        return null;
      }
      const data = await response.json();
      console.log(`[vevioz] attempt ${attempt + 1}: status=${data.status} pc=${data.pc}`);

      if (data.status === 'ok' && data.link) {
        return { downloadUrl: data.link };
      }
      if (data.status === 'fail') {
        return null;
      }
      if (data.link && data.status !== 'processing') {
        return { downloadUrl: data.link };
      }
      // Still processing - wait and retry
      await new Promise((r) => setTimeout(r, 3000));
    } catch (e) {
      console.error('[vevioz] error:', e);
      return null;
    }
  }
  return null; // Still processing after max attempts
}

// Download MP3 with retries
async function downloadAudio(downloadUrl: string): Promise<Uint8Array | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      console.log(`Download retry ${attempt + 1}...`);
      await new Promise((r) => setTimeout(r, 5000));
    }
    try {
      const response = await fetch(downloadUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'audio/mpeg, audio/*, */*',
          'Referer': 'https://youtube-mp36.p.rapidapi.com/',
        },
        redirect: 'follow',
      });
      if (response.ok) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 1000) return bytes;
        console.log('File too small:', bytes.length);
      } else {
        const text = await response.text();
        console.error('Download failed:', response.status, text.slice(0, 200));
      }
    } catch (e) {
      console.error('Download error:', e);
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, title: userTitle, communicatorId } = await req.json();

    if (!url) {
      return jsonResponse({ success: false, error: 'URL is required' }, 400);
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return jsonResponse({ success: false, error: 'Invalid YouTube URL' }, 400);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ success: false, error: 'Authorization required' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const rapidApiKey = Deno.env.get('RAPIDAPI_KEY');

    if (!rapidApiKey) {
      return jsonResponse({
        success: false,
        fallback: true,
        error: 'YouTube extraction is not configured. Please add your RapidAPI key.',
      });
    }

    // Auth check
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ success: false, error: 'Invalid authentication' }, 401);
    }

    const resolvedTitle = userTitle || (await fetchYouTubeTitle(videoId)) || 'YouTube Audio';
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

    // Try quick conversion (~24s max: 8 attempts × 3s)
    const quickResult = await quickVeviozAttempt(videoId, rapidApiKey, 8);

    if (quickResult) {
      // Short video - completed quickly. Download and upload now.
      console.log('Quick conversion succeeded, downloading...');
      const audioBytes = await downloadAudio(quickResult.downloadUrl);
      if (!audioBytes) {
        return jsonResponse({ success: false, fallback: true, title: resolvedTitle, error: 'Failed to download converted audio.' });
      }

      const filePath = `${user.id}/${crypto.randomUUID()}.mp3`;
      const { error: uploadError } = await adminSupabase.storage.from('sermons').upload(filePath, audioBytes, { contentType: 'audio/mpeg', upsert: false });
      if (uploadError) {
        return jsonResponse({ success: false, error: 'Storage upload failed: ' + uploadError.message });
      }

      const { data: sermon, error: sermonError } = await adminSupabase.from('sermons').insert({
        user_id: user.id, title: resolvedTitle, file_url: filePath,
        file_type: 'audio/mpeg', transcription_status: 'pending',
        communicator_id: communicatorId || null,
      }).select('id').single();

      if (sermonError) {
        return jsonResponse({ success: false, error: 'Failed to create sermon: ' + sermonError.message });
      }

      // Fire-and-forget transcription
      adminSupabase.functions.invoke('transcribe-sermon', { body: { sermonId: sermon.id } }).catch(console.error);

      return jsonResponse({ success: true, status: 'completed', title: resolvedTitle, sermonId: sermon.id });
    }

    // Long video - conversion still in progress. Create a placeholder sermon and return immediately.
    console.log('Conversion still processing, creating async job...');
    const { data: sermon, error: sermonError } = await adminSupabase.from('sermons').insert({
      user_id: user.id, title: resolvedTitle, file_url: `youtube:${videoId}`,
      file_type: 'audio/mpeg', transcription_status: 'downloading',
      communicator_id: communicatorId || null,
      error_message: JSON.stringify({ videoId, provider: 'vevioz' }),
    }).select('id').single();

    if (sermonError) {
      return jsonResponse({ success: false, error: 'Failed to create sermon: ' + sermonError.message });
    }

    return jsonResponse({ success: true, status: 'converting', title: resolvedTitle, sermonId: sermon.id });

  } catch (error) {
    console.error('Error:', error);
    return jsonResponse({ success: false, fallback: true, error: 'An unexpected error occurred.' });
  }
});
