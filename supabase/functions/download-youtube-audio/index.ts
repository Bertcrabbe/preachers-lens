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
    errorStage:
      | 'missing_url'
      | 'invalid_url'
      | 'auth_required'
      | 'invalid_auth'
      | 'metadata_lookup_failed'
      | 'audio_extraction_unavailable';
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

    const response = await fetch(oembedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    });

    if (!response.ok) {
      console.error('YouTube oEmbed lookup failed:', response.status);
      return null;
    }

    const data = await response.json();
    return typeof data?.title === 'string' ? data.title : null;
  } catch (error) {
    console.error('YouTube oEmbed request failed:', error);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, title: userTitle } = await req.json();

    if (!url) {
      return jsonResponse({
        success: false,
        error: 'URL is required',
        diagnostics: {
          provider: 'youtube',
          errorStage: 'missing_url',
        },
      }, 400);
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return jsonResponse({
        success: false,
        error: 'Invalid YouTube URL',
        diagnostics: {
          provider: 'youtube',
          errorStage: 'invalid_url',
        },
      }, 400);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({
        success: false,
        error: 'Authorization required',
        diagnostics: {
          provider: 'youtube',
          videoId,
          errorStage: 'auth_required',
        },
      }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return jsonResponse({
        success: false,
        error: 'Invalid authentication',
        diagnostics: {
          provider: 'youtube',
          videoId,
          errorStage: 'invalid_auth',
        },
      }, 401);
    }

    const resolvedTitle = userTitle || (await fetchYouTubeTitle(videoId)) || 'YouTube Audio';

    return jsonResponse({
      success: false,
      fallback: true,
      title: resolvedTitle,
      error:
        'YouTube audio extraction is not available from this backend right now. YouTube now protects audio streams behind signed requests, so please download the audio manually and upload the file directly.',
      diagnostics: {
        provider: 'youtube',
        videoId,
        errorStage: 'audio_extraction_unavailable',
      },
    });
  } catch (error) {
    console.error('Error processing YouTube URL:', error);

    return jsonResponse({
      success: false,
      fallback: true,
      error:
        'YouTube audio extraction is not available from this backend right now. Please download the audio manually and upload the file directly.',
      diagnostics: {
        provider: 'youtube',
        errorStage: 'audio_extraction_unavailable',
      },
    });
  }
});
