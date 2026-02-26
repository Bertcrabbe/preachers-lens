import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const assemblyAIApiKey = Deno.env.get('ASSEMBLYAI_API_KEY');
    if (!assemblyAIApiKey) {
      throw new Error('ASSEMBLYAI_API_KEY is not configured');
    }

    const formData = await req.formData();
    const audioFile = formData.get('audio') as File;

    if (!audioFile) {
      throw new Error('No audio file provided');
    }

    // Ensure we have actual audio data (not an empty/corrupt file)
    if (audioFile.size < 1000) {
      throw new Error(`Audio file too small (${audioFile.size} bytes) - recording may have failed`);
    }

    console.log('Transcribing audio comment with AssemblyAI:', audioFile.name, 'Size:', audioFile.size, 'Type:', audioFile.type);

    // Step 1: Upload the audio file to AssemblyAI
    const audioBuffer = await audioFile.arrayBuffer();
    const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: {
        'Authorization': assemblyAIApiKey,
        'Content-Type': 'application/octet-stream',
        'Transfer-Encoding': 'chunked',
      },
      body: audioBuffer,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('AssemblyAI upload error:', uploadResponse.status, errorText);
      throw new Error(`Failed to upload audio: ${errorText}`);
    }

    const uploadData = await uploadResponse.json();
    const audioUrl = uploadData.upload_url;
    console.log('Audio uploaded, URL:', audioUrl);

    // Step 2: Create transcription request
    const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        'Authorization': assemblyAIApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: audioUrl,
        language_code: 'en',
      }),
    });

    if (!transcriptResponse.ok) {
      const errorText = await transcriptResponse.text();
      console.error('AssemblyAI transcript request error:', transcriptResponse.status, errorText);
      throw new Error(`Failed to start transcription: ${errorText}`);
    }

    const transcriptData = await transcriptResponse.json();
    const transcriptId = transcriptData.id;
    console.log('Transcription started, ID:', transcriptId);

    // Step 3: Poll for completion
    let transcript = null;
    const maxAttempts = 60; // Max 60 seconds
    let attempts = 0;

    while (attempts < maxAttempts) {
      const pollingResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: {
          'Authorization': assemblyAIApiKey,
        },
      });

      if (!pollingResponse.ok) {
        const errorText = await pollingResponse.text();
        console.error('AssemblyAI polling error:', pollingResponse.status, errorText);
        throw new Error(`Failed to poll transcription: ${errorText}`);
      }

      transcript = await pollingResponse.json();
      console.log('Transcription status:', transcript.status);

      if (transcript.status === 'completed') {
        break;
      } else if (transcript.status === 'error') {
        throw new Error(`Transcription failed: ${transcript.error}`);
      }

      // Wait 1 second before polling again
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    if (!transcript || transcript.status !== 'completed') {
      throw new Error('Transcription timed out');
    }

    console.log('Transcription result:', transcript.text);

    return new Response(
      JSON.stringify({ text: transcript.text || '' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('Error transcribing audio:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
