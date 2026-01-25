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

    let audioUrl: string | null = null;
    let videoTitle = title || 'YouTube Audio';

    // Try official Cobalt API (api.cobalt.tools) with v10 format
    console.log('Attempting Cobalt API...');
    try {
      const cobaltResponse = await fetch('https://api.cobalt.tools/', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: `https://www.youtube.com/watch?v=${videoId}`,
          downloadMode: 'audio',
          audioFormat: 'mp3',
        }),
      });

      console.log('Cobalt response status:', cobaltResponse.status);

      if (cobaltResponse.ok) {
        const cobaltData = await cobaltResponse.json();
        console.log('Cobalt response type:', cobaltData.status);

        if (cobaltData.status === 'tunnel' || cobaltData.status === 'redirect') {
          audioUrl = cobaltData.url;
          if (cobaltData.filename) {
            videoTitle = title || cobaltData.filename.replace(/\.[^/.]+$/, '');
          }
        } else if (cobaltData.status === 'error') {
          console.log('Cobalt error:', cobaltData.error?.code);
        }
      } else {
        const errorText = await cobaltResponse.text();
        console.log('Cobalt API error:', errorText);
      }
    } catch (cobaltError) {
      console.error('Cobalt API request failed:', cobaltError);
    }

    if (!audioUrl) {
      console.log('Audio extraction failed');
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'YouTube audio extraction is currently unavailable. Please download the audio using a YouTube to MP3 converter tool, then upload the file directly.' 
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
