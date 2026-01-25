import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // Validate YouTube URL
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)/;
    if (!youtubeRegex.test(url)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid YouTube URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Processing YouTube URL:', url);

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

    // Use Cobalt API to get audio download URL
    console.log('Requesting audio from Cobalt API...');
    const cobaltResponse = await fetch('https://api.cobalt.tools/api/json', {
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

    if (!cobaltResponse.ok) {
      const errorText = await cobaltResponse.text();
      console.error('Cobalt API error:', errorText);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to process YouTube video. The service may be temporarily unavailable.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cobaltData = await cobaltResponse.json();
    console.log('Cobalt response status:', cobaltData.status);

    if (cobaltData.status === 'error') {
      return new Response(
        JSON.stringify({ success: false, error: cobaltData.text || 'Failed to extract audio from YouTube' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (cobaltData.status !== 'stream' && cobaltData.status !== 'redirect') {
      return new Response(
        JSON.stringify({ success: false, error: 'Unexpected response from audio extraction service' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const audioUrl = cobaltData.url;
    if (!audioUrl) {
      return new Response(
        JSON.stringify({ success: false, error: 'No audio URL returned' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

    // Extract video title from URL if no custom title provided
    const videoTitle = title || cobaltData.filename?.replace(/\.[^/.]+$/, '') || 'YouTube Audio';

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
