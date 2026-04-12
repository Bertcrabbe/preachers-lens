import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sermonId } = await req.json();
    if (!sermonId) {
      return jsonResponse({ success: false, error: 'sermonId is required' }, 400);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ success: false, error: 'Authorization required' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const rapidApiKey = Deno.env.get('RAPIDAPI_KEY')!;

    // Auth check
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ success: false, error: 'Invalid authentication' }, 401);
    }

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

    // Get sermon record
    const { data: sermon, error: sermonError } = await adminSupabase
      .from('sermons')
      .select('id, user_id, transcription_status, error_message, title')
      .eq('id', sermonId)
      .single();

    if (sermonError || !sermon) {
      return jsonResponse({ success: false, error: 'Sermon not found' }, 404);
    }

    if (sermon.user_id !== user.id) {
      return jsonResponse({ success: false, error: 'Not authorized' }, 403);
    }

    // If already done downloading, return current status
    if (sermon.transcription_status !== 'downloading') {
      return jsonResponse({
        success: true,
        status: sermon.transcription_status === 'error' ? 'failed' : 'completed',
        sermonId: sermon.id,
      });
    }

    // Parse job data
    let jobData: { videoId: string; provider: string };
    try {
      jobData = JSON.parse(sermon.error_message || '{}');
    } catch {
      return jsonResponse({ success: false, error: 'Invalid job data' }, 500);
    }

    if (!jobData.videoId) {
      return jsonResponse({ success: false, error: 'Missing video ID' }, 500);
    }

    // Try vevioz - do ~10 quick polls (~30s worth)
    console.log(`[poll] Checking vevioz for video ${jobData.videoId}...`);
    let downloadUrl: string | null = null;

    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const response = await fetch(`https://youtube-mp36.p.rapidapi.com/dl?id=${jobData.videoId}`, {
          headers: {
            'X-RapidAPI-Key': rapidApiKey,
            'X-RapidAPI-Host': 'youtube-mp36.p.rapidapi.com',
          },
        });

        if (!response.ok) {
          await response.text();
          break;
        }

        const data = await response.json();
        console.log(`[poll] attempt ${attempt + 1}: status=${data.status} pc=${data.pc}`);

        if (data.status === 'ok' && data.link) {
          downloadUrl = data.link;
          break;
        }
        if (data.status === 'fail') {
          // Mark as failed
          await adminSupabase.from('sermons').update({
            transcription_status: 'error',
            error_message: data.msg || 'Conversion failed',
          }).eq('id', sermonId);
          return jsonResponse({ success: true, status: 'failed', error: data.msg || 'Conversion failed' });
        }
        if (data.link && data.status !== 'processing') {
          downloadUrl = data.link;
          break;
        }
        // Still processing
        await new Promise((r) => setTimeout(r, 3000));
      } catch (e) {
        console.error('[poll] error:', e);
        break;
      }
    }

    if (!downloadUrl) {
      // Still converting - tell client to keep polling
      return jsonResponse({ success: true, status: 'converting' });
    }

    // Download the audio
    console.log('[poll] Downloading audio...');
    let audioBytes: Uint8Array | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 5000));
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
          if (bytes.length > 1000) { audioBytes = bytes; break; }
        } else {
          await response.text();
        }
      } catch (e) {
        console.error('[poll] download error:', e);
      }
    }

    if (!audioBytes) {
      return jsonResponse({ success: true, status: 'converting' }); // Retry later
    }

    // Upload to storage
    const filePath = `${user.id}/${crypto.randomUUID()}.mp3`;
    const { error: uploadError } = await adminSupabase.storage
      .from('sermons')
      .upload(filePath, audioBytes, { contentType: 'audio/mpeg', upsert: false });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      await adminSupabase.from('sermons').update({
        transcription_status: 'error',
        error_message: 'Storage upload failed: ' + uploadError.message,
      }).eq('id', sermonId);
      return jsonResponse({ success: true, status: 'failed', error: 'Upload failed' });
    }

    // Update sermon record
    await adminSupabase.from('sermons').update({
      file_url: filePath,
      transcription_status: 'pending',
      error_message: null,
    }).eq('id', sermonId);

    // Trigger transcription
    adminSupabase.functions.invoke('transcribe-sermon', { body: { sermonId } }).catch(console.error);

    console.log('[poll] Complete! Sermon', sermonId, 'audio uploaded and transcription triggered.');
    return jsonResponse({ success: true, status: 'completed', sermonId });

  } catch (error) {
    console.error('Poll error:', error);
    return jsonResponse({ success: false, error: 'An unexpected error occurred' }, 500);
  }
});
