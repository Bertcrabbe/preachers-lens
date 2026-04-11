import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

/**
 * Use YouTube's Innertube API (Android client) to get audio stream URLs.
 * The Android client often returns direct URLs that don't require signature deciphering.
 */
async function getYouTubeAudioUrl(videoId: string): Promise<{ audioUrl: string; title: string }> {
  const playerEndpoint = 'https://www.youtube.com/youtubei/v1/player';

  const body = {
    videoId,
    context: {
      client: {
        clientName: 'ANDROID',
        clientVersion: '19.09.37',
        androidSdkVersion: 30,
        hl: 'en',
        gl: 'US',
        utcOffsetMinutes: 0,
      },
    },
    contentCheckOk: true,
    racyCheckOk: true,
  };

  console.log('Fetching player data for video:', videoId);

  const res = await fetch(playerEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('Innertube player API error:', res.status, errText);
    throw new Error(`YouTube API returned ${res.status}`);
  }

  const data = await res.json();

  const playabilityStatus = data.playabilityStatus?.status;
  if (playabilityStatus !== 'OK') {
    const reason = data.playabilityStatus?.reason || playabilityStatus || 'Unknown';
    console.error('Video not playable:', reason);
    throw new Error(`Video not available: ${reason}`);
  }

  const title = data.videoDetails?.title || 'YouTube Audio';

  // Get adaptive audio formats sorted by bitrate (highest first)
  const adaptiveFormats = data.streamingData?.adaptiveFormats || [];
  const audioFormats = adaptiveFormats
    .filter((f: any) => f.mimeType?.startsWith('audio/'))
    .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

  if (audioFormats.length === 0) {
    console.error('No audio formats found in response');
    throw new Error('No audio streams available for this video');
  }

  // Prefer mp4a (m4a) audio, fallback to opus/webm
  const mp4Audio = audioFormats.find((f: any) => f.mimeType?.includes('mp4a'));
  const selectedFormat = mp4Audio || audioFormats[0];

  const audioUrl = selectedFormat.url;
  if (!audioUrl) {
    // If URL is missing, the stream requires signature deciphering which we can't do server-side
    console.error('Audio URL requires signature deciphering (signatureCipher present)');
    throw new Error('This video requires advanced processing that is not currently supported. Please download the audio manually and upload the file.');
  }

  console.log('Selected audio format:', selectedFormat.mimeType, 'bitrate:', selectedFormat.bitrate);
  return { audioUrl, title };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, title: userTitle, communicatorId } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid YouTube URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Processing YouTube video:', videoId);

    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract audio URL from YouTube
    const { audioUrl, title: videoTitle } = await getYouTubeAudioUrl(videoId);
    const finalTitle = userTitle || videoTitle;

    console.log('Downloading audio stream...');
    const audioResponse = await fetch(audioUrl, {
      headers: {
        'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
      },
    });

    if (!audioResponse.ok) {
      console.error('Audio download failed:', audioResponse.status);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to download audio from YouTube' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const audioBuffer = await audioResponse.arrayBuffer();
    const sizeMB = audioBuffer.byteLength / 1024 / 1024;
    console.log('Audio downloaded:', sizeMB.toFixed(2), 'MB');

    if (audioBuffer.byteLength > 300 * 1024 * 1024) {
      return new Response(
        JSON.stringify({ success: false, error: 'Audio file too large (max 300MB)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine content type from the selected format
    const contentType = audioResponse.headers.get('content-type') || 'audio/mp4';
    const ext = contentType.includes('webm') ? 'webm' : 'm4a';
    const fileName = `${user.id}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('sermons')
      .upload(fileName, audioBuffer, { contentType, upsert: false });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to upload audio file' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: sermon, error: dbError } = await supabase
      .from('sermons')
      .insert({
        user_id: user.id,
        title: finalTitle,
        file_url: fileName,
        file_type: 'audio',
        transcription_status: 'pending',
        communicator_id: communicatorId || null,
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to create sermon record' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Sermon created:', sermon.id);

    supabase.functions.invoke('transcribe-sermon', {
      body: { sermonId: sermon.id },
    }).catch((err: any) => console.error('Transcription trigger failed:', err));

    return new Response(
      JSON.stringify({ success: true, sermonId: sermon.id, title: finalTitle }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error processing YouTube URL:', error);
    const msg = error instanceof Error ? error.message : 'Failed to process YouTube URL';
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
