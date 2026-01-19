import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PodcastEpisode {
  title: string;
  audioUrl: string;
  duration?: string;
}

// Parse Apple Podcasts URL to extract podcast ID and episode ID
function parseApplePodcastsUrl(url: string): { podcastId: string; episodeId?: string } | null {
  try {
    const parsed = new URL(url);
    
    // Format: https://podcasts.apple.com/us/podcast/podcast-name/id123456789?i=1000123456789
    // or: https://podcasts.apple.com/us/podcast/episode-name/id123456789?i=1000123456789
    const pathMatch = parsed.pathname.match(/\/id(\d+)/);
    if (!pathMatch) return null;
    
    const podcastId = pathMatch[1];
    const episodeId = parsed.searchParams.get('i') || undefined;
    
    return { podcastId, episodeId };
  } catch {
    return null;
  }
}

// Get RSS feed URL from Apple's iTunes API
async function getRssFeedUrl(podcastId: string): Promise<string | null> {
  const lookupUrl = `https://itunes.apple.com/lookup?id=${podcastId}&entity=podcast`;
  console.log("Looking up podcast:", lookupUrl);
  
  const response = await fetch(lookupUrl);
  if (!response.ok) {
    console.error("iTunes lookup failed:", response.status);
    return null;
  }
  
  const data = await response.json();
  if (data.resultCount === 0 || !data.results[0]) {
    console.error("Podcast not found in iTunes");
    return null;
  }
  
  const feedUrl = data.results[0].feedUrl;
  console.log("Found RSS feed URL:", feedUrl);
  return feedUrl;
}

// Parse RSS feed and find episode
async function getEpisodeFromFeed(feedUrl: string, episodeId?: string): Promise<PodcastEpisode | null> {
  console.log("Fetching RSS feed:", feedUrl);
  
  const response = await fetch(feedUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; PodcastDownloader/1.0)",
    },
  });
  
  if (!response.ok) {
    console.error("Failed to fetch RSS feed:", response.status);
    return null;
  }
  
  const xml = await response.text();
  
  // Parse XML to find episodes
  // Look for <item> elements with <enclosure> tags
  const items = xml.split('<item>').slice(1);
  
  if (items.length === 0) {
    console.error("No episodes found in RSS feed");
    return null;
  }
  
  console.log(`Found ${items.length} episodes in feed`);
  
  // If we have an episode ID, try to find that specific episode
  if (episodeId) {
    for (const item of items) {
      // Check if this item matches the episode ID (Apple uses guid or episode number)
      if (item.includes(episodeId)) {
        const episode = parseEpisodeItem(item);
        if (episode) {
          console.log("Found matching episode:", episode.title);
          return episode;
        }
      }
    }
    console.log("Specific episode not found, using latest");
  }
  
  // Default to the first (latest) episode
  const episode = parseEpisodeItem(items[0]);
  if (episode) {
    console.log("Using latest episode:", episode.title);
  }
  return episode;
}

function parseEpisodeItem(itemXml: string): PodcastEpisode | null {
  // Extract title
  const titleMatch = itemXml.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
  const title = titleMatch ? decodeXmlEntities(titleMatch[1]) : "Untitled Episode";
  
  // Extract enclosure URL (the actual audio file)
  const enclosureMatch = itemXml.match(/<enclosure[^>]+url=["']([^"']+)["']/);
  if (!enclosureMatch) {
    // Try alternative format
    const altMatch = itemXml.match(/<enclosure[^>]+url="([^"]+)"/);
    if (!altMatch) {
      console.log("No enclosure URL found in episode");
      return null;
    }
    return { title, audioUrl: decodeXmlEntities(altMatch[1]) };
  }
  
  const audioUrl = decodeXmlEntities(enclosureMatch[1]);
  
  // Extract duration if available
  const durationMatch = itemXml.match(/<itunes:duration>([^<]+)<\/itunes:duration>/);
  const duration = durationMatch ? durationMatch[1] : undefined;
  
  return { title, audioUrl, duration };
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, title: customTitle, communicatorId } = await req.json();

    if (!url) {
      throw new Error("URL is required");
    }

    console.log("Processing podcast URL:", url);

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

    // Parse Apple Podcasts URL
    const podcastInfo = parseApplePodcastsUrl(url);
    if (!podcastInfo) {
      throw new Error("Invalid Apple Podcasts URL. Please use a link from podcasts.apple.com");
    }

    console.log("Parsed podcast info:", podcastInfo);

    // Get RSS feed URL from iTunes API
    const feedUrl = await getRssFeedUrl(podcastInfo.podcastId);
    if (!feedUrl) {
      throw new Error("Could not find podcast RSS feed. The podcast may not be available.");
    }

    // Get episode from RSS feed
    const episode = await getEpisodeFromFeed(feedUrl, podcastInfo.episodeId);
    if (!episode) {
      throw new Error("Could not find episode audio. The episode may not be available for download.");
    }

    console.log("Downloading audio from:", episode.audioUrl);

    // Download the audio file
    const audioResponse = await fetch(episode.audioUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PodcastDownloader/1.0)",
      },
    });

    if (!audioResponse.ok) {
      throw new Error(`Failed to download audio: ${audioResponse.status} ${audioResponse.statusText}`);
    }

    const contentType = audioResponse.headers.get("content-type") || "";
    const contentLength = audioResponse.headers.get("content-length");
    
    console.log("Content-Type:", contentType, "Content-Length:", contentLength);

    // Check file size (300MB limit)
    if (contentLength && parseInt(contentLength) > 300 * 1024 * 1024) {
      throw new Error("Episode file size exceeds 300MB limit");
    }

    // Determine file extension
    let fileExt = "mp3"; // default for podcasts
    if (episode.audioUrl.match(/\.m4a(\?|$)/i) || contentType.includes("m4a") || contentType.includes("mp4")) {
      fileExt = "m4a";
    } else if (episode.audioUrl.match(/\.wav(\?|$)/i) || contentType.includes("wav")) {
      fileExt = "wav";
    }

    // Download the audio data
    const audioBuffer = await audioResponse.arrayBuffer();
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

    // Use custom title or episode title
    const sermonTitle = customTitle || episode.title;

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
        episodeTitle: episode.title,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error processing podcast:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
