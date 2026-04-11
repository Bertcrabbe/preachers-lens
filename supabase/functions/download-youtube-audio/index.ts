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
    detail?: string;
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

// Try multiple RapidAPI YouTube-to-MP3 providers in order
async function extractAudioViaRapidAPI(
  videoId: string,
  rapidApiKey: string
): Promise<{ downloadUrl: string } | { error: string }> {
  // Provider 1: youtube-mp36 (Vevioz)
  const provider1 = await tryVevioz(videoId, rapidApiKey);
  if (provider1 && 'downloadUrl' in provider1) return provider1;

  // Provider 2: youtube-to-mp315
  const provider2 = await tryMp315(videoId, rapidApiKey);
  if (provider2 && 'downloadUrl' in provider2) return provider2;

  const errors = [provider1?.error, provider2?.error].filter(Boolean).join('; ');
  return { error: errors || 'All providers failed' };
}

async function tryVevioz(videoId: string, rapidApiKey: string): Promise<{ downloadUrl: string } | { error: string }> {
  try {
    console.log('[vevioz] Trying video:', videoId);
    const response = await fetch(`https://youtube-mp36.p.rapidapi.com/dl?id=${videoId}`, {
      headers: {
        'X-RapidAPI-Key': rapidApiKey,
        'X-RapidAPI-Host': 'youtube-mp36.p.rapidapi.com',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('[vevioz] Error:', response.status, text);
      return { error: `vevioz: ${response.status}` };
    }

    const data = await response.json();
    console.log('[vevioz] Response:', JSON.stringify(data).slice(0, 200));

    if (data.status === 'ok' && data.link) {
      return { downloadUrl: data.link };
    }
    return { error: data.msg || `vevioz: status=${data.status}` };
  } catch (e) {
    console.error('[vevioz] Exception:', e);
    return { error: `vevioz: ${e.message}` };
  }
}

async function tryMp315(videoId: string, rapidApiKey: string): Promise<{ downloadUrl: string } | { error: string }> {
  try {
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log('[mp315] Trying video:', videoId);

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
      console.error('[mp315] Error:', convResponse.status, text);
      return { error: `mp315: ${convResponse.status}` };
    }

    const convData = await convResponse.json();
    console.log('[mp315] Response:', JSON.stringify(convData).slice(0, 200));

    if (convData.status === 'AVAILABLE' && convData.downloadUrl) {
      return { downloadUrl: convData.downloadUrl };
    }

    if (convData.status === 'CONVERSION_ERROR') {
      return { error: 'mp315: conversion error' };
    }

    // Poll if converting
    if (convData.status === 'CONVERTING' && convData.id) {
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const statusResponse = await fetch(
          `https://youtube-to-mp315.p.rapidapi.com/status/${convData.id}`,
          {
            headers: {
              'X-RapidAPI-Key': rapidApiKey,
              'X-RapidAPI-Host': 'youtube-to-mp315.p.rapidapi.com',
            },
          }
        );
        if (!statusResponse.ok) continue;
        const statusData = await statusResponse.json();
        if (statusData.status === 'AVAILABLE' && statusData.downloadUrl) {
          return { downloadUrl: statusData.downloadUrl };
        }
        if (statusData.status === 'CONVERSION_ERROR' || statusData.status === 'EXPIRED') {
          return { error: `mp315: ${statusData.status.toLowerCase()}` };
        }
      }
      return { error: 'mp315: conversion timed out' };
    }

    return { error: convData.msg || 'mp315: unexpected response' };
  } catch (e) {
    console.error('[mp315] Exception:', e);
    return { error: `mp315: ${e.message}` };
  }
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

    // Extract audio via RapidAPI (tries multiple providers)
    const result = await extractAudioViaRapidAPI(videoId, rapidApiKey);
    if ('error' in result) {
      return jsonResponse({
        success: false,
        fallback: true,
        title: resolvedTitle,
        error: result.error,
        diagnostics: { provider: 'youtube', videoId, errorStage: 'extraction_failed', detail: result.error },
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
