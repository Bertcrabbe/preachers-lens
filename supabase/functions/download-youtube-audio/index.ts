import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Extract YouTube video ID from various URL formats
function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&?\s]+)/,
    /youtube\.com\/watch\?.*v=([^&?\s]+)/,
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, title, communicatorId } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate YouTube URL and extract video ID
    const videoId = extractVideoId(url);
    if (!videoId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid YouTube URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Processing YouTube URL:', url, 'Video ID:', videoId);

    // Get auth header and create Supabase client
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
      global: { headers: { Authorization: authHeader } }
    });

    // Get user ID
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const userId = claimsData.claims.sub;

    // Use community Cobalt instance (co.wuk.sh) which doesn't require auth
    console.log('Requesting audio from Cobalt community instance...');
    const cobaltResponse = await fetch('https://co.wuk.sh/api/json', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: url,
        vCodec: 'h264',
        vQuality: '720',
        aFormat: 'mp3',
        isAudioOnly: true,
        filenamePattern: 'basic',
      }),
    });

    let audioUrl: string | null = null;
    let videoTitle = title || 'YouTube Audio';

    if (cobaltResponse.ok) {
      const cobaltData = await cobaltResponse.json();
      console.log('Cobalt response:', cobaltData.status);

      if (cobaltData.status === 'stream' || cobaltData.status === 'redirect') {
        audioUrl = cobaltData.url;
        if (cobaltData.filename) {
          videoTitle = title || cobaltData.filename.replace(/\.[^/.]+$/, '');
        }
      }
    }

    // Fallback: Try ytdl-core style API endpoint
    if (!audioUrl) {
      console.log('Cobalt failed, trying alternative API...');
      
      // Try a different community instance
      const altResponse = await fetch('https://api.vevioz.com/api/button/mp3/' + videoId, {
        headers: {
          'Accept': 'text/html',
        },
      });

      if (altResponse.ok) {
        const html = await altResponse.text();
        // Parse the HTML to find the download link
        const linkMatch = html.match(/href="(https:\/\/[^"]+\.mp3[^"]*)"/);
        if (linkMatch && linkMatch[1]) {
          audioUrl = linkMatch[1];
          console.log('Found audio URL from Vevioz');
        }
      }
    }

    if (!audioUrl) {
      console.error('All audio extraction methods failed');
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'YouTube audio extraction is currently unavailable. Please try uploading the audio file directly or use an Apple Podcasts link.' 
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Downloading audio from:', audioUrl);

    // Download the audio file
    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) {
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to download audio file' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const audioBuffer = await audioResponse.arrayBuffer();
    const audioSize = audioBuffer.byteLength;

    // Check file size (300MB limit)
    if (audioSize > 300 * 1024 * 1024) {
      return new Response(
        JSON.stringify({ success: false, error: 'Audio file too large (max 300MB)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Audio downloaded, size:', (audioSize / 1024 / 1024).toFixed(2), 'MB');

    // Generate file name and upload to storage
    const fileName = `${userId}/${Date.now()}.mp3`;
    
    const { error: uploadError } = await supabase.storage
      .from('sermons')
      .upload(fileName, audioBuffer, {
        contentType: 'audio/mpeg',
        upsert: false,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to upload audio file' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create sermon record
    const { data: sermon, error: dbError } = await supabase
      .from('sermons')
      .insert({
        user_id: userId,
        title: videoTitle,
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

    // Trigger transcription
    const { error: transcribeError } = await supabase.functions.invoke('transcribe-sermon', {
      body: { sermonId: sermon.id }
    });

    if (transcribeError) {
      console.error('Transcription trigger failed:', transcribeError);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        sermonId: sermon.id,
        title: videoTitle 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing YouTube URL:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to process YouTube URL';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
