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

async function extractAudioViaRapidAPI(videoId: string, rapidApiKey: string): Promise<{ downloadUrl: string } | { error: string }> {
  // Step 1: Get download link from Vevioz API
  const apiUrl = `https://youtube-mp36.p.rapidapi.com/dl?id=${videoId}`;
  
  console.log('Calling RapidAPI Vevioz for video:', videoId);
  
  const response = await fetch(apiUrl, {
    headers: {
      'X-RapidAPI-Key': rapidApiKey,
      'X-RapidAPI-Host': 'youtube-mp36.p.rapidapi.com',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('RapidAPI error:', response.status, text);
    return { error: `RapidAPI returned ${response.status}` };
  }

  const data = await response.json();
  console.log('RapidAPI response status:', data.status);

  if (data.status === 'ok' && data.link) {
    return { downloadUrl: data.link };
  }

  // Some APIs return a processing status - poll if needed
  if (data.status === 'processing' || data.status === 'fail') {
    return { error: data.msg || 'Conversion failed or is still processing. Please try again.' };
  }

  return { error: data.msg || 'Unexpected API response' };
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

    // Download the MP3 from the conversion link
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

    // Upload to Supabase storage using service role
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
        title: resolvedTitle,
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
      title: resolvedTitle,
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
