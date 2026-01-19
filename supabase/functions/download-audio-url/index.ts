import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, title, communicatorId } = await req.json();

    if (!url) {
      throw new Error("URL is required");
    }

    console.log("Downloading audio from URL:", url);

    // Get the authorization header to identify the user
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      throw new Error("Authorization header required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify the user from the JWT
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      throw new Error("Invalid authentication");
    }

    console.log("User authenticated:", user.id);

    // Download the audio file from the URL
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SermonDownloader/1.0)",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "";
    const contentLength = response.headers.get("content-length");
    
    console.log("Content-Type:", contentType, "Content-Length:", contentLength);

    // Check if it's an audio file
    const validAudioTypes = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/m4a", "audio/x-m4a", "audio/mp4", "audio/aac", "application/octet-stream"];
    const isAudio = validAudioTypes.some(type => contentType.includes(type)) || 
                    url.match(/\.(mp3|wav|m4a|aac)(\?|$)/i);
    
    if (!isAudio) {
      throw new Error(`URL does not appear to be an audio file. Content-Type: ${contentType}`);
    }

    // Check file size (300MB limit)
    if (contentLength && parseInt(contentLength) > 300 * 1024 * 1024) {
      throw new Error("File size exceeds 300MB limit");
    }

    // Determine file extension
    let fileExt = "mp3"; // default
    if (url.match(/\.wav(\?|$)/i) || contentType.includes("wav")) {
      fileExt = "wav";
    } else if (url.match(/\.m4a(\?|$)/i) || contentType.includes("m4a") || contentType.includes("mp4")) {
      fileExt = "m4a";
    }

    // Download the audio data
    const audioBuffer = await response.arrayBuffer();
    const audioData = new Uint8Array(audioBuffer);

    console.log("Downloaded audio size:", audioData.length, "bytes");

    // Generate filename
    const fileName = `${user.id}/${Date.now()}.${fileExt}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("sermons")
      .upload(fileName, audioData, {
        contentType: contentType.includes("audio") ? contentType : `audio/${fileExt}`,
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    console.log("Uploaded to storage:", fileName);

    // Extract title from URL if not provided
    let sermonTitle = title;
    if (!sermonTitle) {
      try {
        const urlPath = new URL(url).pathname;
        sermonTitle = decodeURIComponent(urlPath.split("/").pop()?.replace(/\.[^/.]+$/, "") || "Untitled Sermon");
      } catch {
        sermonTitle = "Untitled Sermon";
      }
    }

    // Create sermon record
    const { data: sermon, error: dbError } = await supabase
      .from("sermons")
      .insert({
        user_id: user.id,
        title: sermonTitle,
        file_url: fileName,
        file_type: "audio",
        transcription_status: "pending",
        communicator_id: communicatorId || null,
      })
      .select()
      .single();

    if (dbError) {
      throw new Error(`Database insert failed: ${dbError.message}`);
    }

    console.log("Sermon record created:", sermon.id);

    // Trigger transcription
    const { error: transcribeError } = await supabase.functions.invoke("transcribe-sermon", {
      body: { sermonId: sermon.id },
    });

    if (transcribeError) {
      console.error("Transcription trigger failed:", transcribeError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        sermon,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error downloading audio:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
