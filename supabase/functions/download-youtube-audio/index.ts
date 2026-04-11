import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type YoutubeResponse = {
  success: boolean;
  fallback?: boolean;
  error?: string;
  title?: string;
  sermonId?: string;
  diagnostics?: {
    provider: 'youtube';
    videoId?: string;
    errorStage: string;
  };
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

async function extractAudioViaRapidAPI(
  videoId: string,
  rapidApiKey: string
): Promise<{ downloadUrl: string; title?: string } | { error: string }> {
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Step 1: Request conversion
  console.log('Requesting conversion for video:', videoId);
  const params = new URLSearchParams({ url: youtubeUrl, format: 'mp3', quality: '0' });
  const convResponse = await fetch(`https://youtube-to-mp315.p.rapidapi.com/download?${params}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-RapidAPI-Key': rapidApiKey,
      'X-RapidAPI-Host': 'youtube-to-mp315.p.rapidapi.com',
    },
  });

  if (!convResponse.ok) {
    const text = await convResponse.text();
    console.error('RapidAPI conversion error:', convResponse.status, text);
    return { error: `RapidAPI returned ${convResponse.status}` };
  }

  const convData = await convResponse.json();
  console.log('Conversion response status:', convData.status, 'id:', convData.id);

  // If already available, return immediately
  if (convData.status === 'AVAILABLE' && convData.downloadUrl) {
    return { downloadUrl: convData.downloadUrl, title: convData.title };
  }

  if (convData.status === 'CONVERSION_ERROR') {
    return { error: 'Conversion failed. The video may be restricted or too long.' };
  }

  // Step 2: Poll for status if CONVERTING
  if (convData.status === 'CONVERTING' && convData.id) {
    const maxAttempts = 30; // ~60 seconds max
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 2000));

      console.log(`Polling status attempt ${i + 1}/${maxAttempts}...`);
      const statusResponse = await fetch(
        `https://youtube-to-mp315.p.rapidapi.com/status/${convData.id}`,
        {
          headers: {
            'X-RapidAPI-Key': rapidApiKey,
            'X-RapidAPI-Host': 'youtube-to-mp315.p.rapidapi.com',
          },
        }
      );

      if (!statusResponse.ok) {
        console.error('Status poll error:', statusResponse.status);
        continue;
      }

      const statusData = await statusResponse.json();
      console.log('Poll status:', statusData.status);

      if (statusData.status === 'AVAILABLE' && statusData.downloadUrl) {
        return { downloadUrl: statusData.downloadUrl, title: statusData.title };
      }

      if (statusData.status === 'CONVERSION_ERROR' || statusData.status === 'EXPIRED') {
        return { error: `Conversion ${statusData.status.toLowerCase()}. Please try again.` };
      }
    }

    return { error: 'Conversion timed out. Please try again.' };
  }

  return { error: convData.msg || 'Unexpected API response' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, title: userTitle, communicatorId } = await req.json();

    if (!url) {
      return jsonResponse({ success: false, error: 'URL is required', diagnostics: { provider: 'youtube', errorStage: 'missing_url' } }, 400);
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return jsonResponse({ success: false, error: 'Invalid YouTube URL', diagnostics: { provider: 'youtube', errorStage: 'invalid_url' } }, 400);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ success: false, error: 'Authorization required', diagnostics: { provider: 'youtube', videoId, errorStage: 'auth_required' } }, 401);
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
        diagnostics: { provider: 'youtube', videoId, errorStage: 'missing_api_key' },
      });
    }

    // Auth check
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ success: false, error: 'Invalid authentication', diagnostics: { provider: 'youtube', videoId, errorStage: 'invalid_auth' } }, 401);
    }

    // Get title
    const resolvedTitle = userTitle || (await fetchYouTubeTitle(videoId)) || 'YouTube Audio';

    // Extract audio via RapidAPI
    const result = await extractAudioViaRapidAPI(videoId, rapidApiKey);
    if ('error' in result) {
      return jsonResponse({
        success: false,
        fallback: true,
        title: resolvedTitle,
        error: result.error,
        diagnostics: { provider: 'youtube', videoId, errorStage: 'extraction_failed' },
      });
    }

    // Download the MP3
    console.log('Downloading converted audio...');
    const audioResponse = await fetch(result.downloadUrl);
    if (!audioResponse.ok) {
      return jsonResponse({
        success: false,
        fallback: true,
        title: resolvedTitle,
        error: 'Failed to download converted audio file.',
        diagnostics: { provider: 'youtube', videoId, errorStage: 'download_failed' },
      });
    }

    const audioBlob = await audioResponse.arrayBuffer();
    const audioBytes = new Uint8Array(audioBlob);
    console.log('Downloaded audio size:', audioBytes.length, 'bytes');

    // Use API-returned title if available
    const finalTitle = result.title || resolvedTitle;

    // Upload to storage
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey);
    const filePath = `${user.id}/${crypto.randomUUID()}.mp3`;

    const { error: uploadError } = await adminSupabase.storage
      .from('sermons')
      .upload(filePath, audioBytes, { contentType: 'audio/mpeg', upsert: false });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return jsonResponse({
        success: false,
        error: 'Failed to upload audio to storage: ' + uploadError.message,
        diagnostics: { provider: 'youtube', videoId, errorStage: 'upload_failed' },
      });
    }

    // Create sermon record
    const { data: sermon, error: sermonError } = await adminSupabase
      .from('sermons')
      .insert({
        user_id: user.id,
        title: finalTitle,
        file_url: filePath,
        file_type: 'audio/mpeg',
        transcription_status: 'pending',
        communicator_id: communicatorId || null,
      })
      .select('id')
      .single();

    if (sermonError) {
      console.error('Sermon insert error:', sermonError);
      return jsonResponse({
        success: false,
        error: 'Failed to create sermon record: ' + sermonError.message,
        diagnostics: { provider: 'youtube', videoId, errorStage: 'db_insert_failed' },
      });
    }

    // Trigger transcription
    try {
      await adminSupabase.functions.invoke('transcribe-sermon', {
        body: { sermonId: sermon.id },
      });
    } catch (e) {
      console.error('Transcription trigger failed (non-blocking):', e);
    }

    return jsonResponse({
      success: true,
      title: finalTitle,
      sermonId: sermon.id,
    });
  } catch (error) {
    console.error('Error processing YouTube URL:', error);
    return jsonResponse({
      success: false,
      fallback: true,
      error: 'An unexpected error occurred. Please try again or upload the audio manually.',
      diagnostics: { provider: 'youtube', errorStage: 'unexpected_error' },
    });
  }
});
