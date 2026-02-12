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

function parseApplePodcastsUrl(url: string): { podcastId: string; episodeId?: string } | null {
  try {
    const parsed = new URL(url);
    const pathMatch = parsed.pathname.match(/\/id(\d+)/);
    if (!pathMatch) return null;
    const podcastId = pathMatch[1];
    const episodeId = parsed.searchParams.get('i') || undefined;
    return { podcastId, episodeId };
  } catch {
    return null;
  }
}

async function getRssFeedUrl(podcastId: string): Promise<string | null> {
  const lookupUrl = `https://itunes.apple.com/lookup?id=${podcastId}&entity=podcast`;
  console.log("Looking up podcast:", lookupUrl);
  const response = await fetch(lookupUrl);
  if (!response.ok) return null;
  const data = await response.json();
  if (data.resultCount === 0 || !data.results[0]) return null;
  return data.results[0].feedUrl;
}

async function getEpisodeFromFeed(feedUrl: string, episodeId?: string): Promise<PodcastEpisode | null> {
  console.log("Fetching RSS feed:", feedUrl);
  const response = await fetch(feedUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PodcastDownloader/1.0)" },
  });
  if (!response.ok) return null;
  const xml = await response.text();
  const items = xml.split('<item>').slice(1);
  if (items.length === 0) return null;
  console.log(`Found ${items.length} episodes in feed`);

  if (episodeId) {
    for (const item of items) {
      if (item.includes(episodeId)) {
        const episode = parseEpisodeItem(item);
        if (episode) return episode;
      }
    }
  }
  return parseEpisodeItem(items[0]);
}

function parseEpisodeItem(itemXml: string): PodcastEpisode | null {
  const titleMatch = itemXml.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
  const title = titleMatch ? decodeXmlEntities(titleMatch[1]) : "Untitled Episode";
  const enclosureMatch = itemXml.match(/<enclosure[^>]+url=["']([^"']+)["']/);
  if (!enclosureMatch) return null;
  const audioUrl = decodeXmlEntities(enclosureMatch[1]);
  const durationMatch = itemXml.match(/<itunes:duration>([^<]+)<\/itunes:duration>/);
  return { title, audioUrl, duration: durationMatch ? durationMatch[1] : undefined };
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, title: customTitle, communicatorId } = await req.json();
    if (!url) throw new Error("URL is required");

    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("Authorization header required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Invalid authentication");

    const podcastInfo = parseApplePodcastsUrl(url);
    if (!podcastInfo) throw new Error("Invalid Apple Podcasts URL");

    const feedUrl = await getRssFeedUrl(podcastInfo.podcastId);
    if (!feedUrl) throw new Error("Could not find podcast RSS feed");

    const episode = await getEpisodeFromFeed(feedUrl, podcastInfo.episodeId);
    if (!episode) throw new Error("Could not find episode audio");

    console.log("Downloading audio from:", episode.audioUrl);

    // Use HEAD request first to check size and content type without downloading
    const headResponse = await fetch(episode.audioUrl, {
      method: "HEAD",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PodcastDownloader/1.0)" },
    });

    const contentType = headResponse.headers.get("content-type") || "";
    const contentLength = headResponse.headers.get("content-length");
    console.log("Content-Type:", contentType, "Content-Length:", contentLength);

    // Reject files over 100MB to stay within edge function limits
    if (contentLength && parseInt(contentLength) > 100 * 1024 * 1024) {
      throw new Error(
        `Episode file is too large (${Math.round(parseInt(contentLength) / 1024 / 1024)}MB). ` +
        `Maximum supported size for podcast downloads is 100MB. ` +
        `Please download the audio file manually and upload it directly.`
      );
    }

    // Reject video files - they're too large and not what we want
    if (contentType.startsWith("video/")) {
      throw new Error(
        "This podcast feed contains video episodes instead of audio. " +
        "Video files are too large to process. Please download the audio version " +
        "of the episode manually and upload it directly."
      );
    }

    // Now do the actual download
    const audioResponse = await fetch(episode.audioUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PodcastDownloader/1.0)" },
    });

    if (!audioResponse.ok) {
      throw new Error(`Failed to download audio: ${audioResponse.status}`);
    }

    // Determine file extension
    let fileExt = "mp3";
    if (episode.audioUrl.match(/\.m4a(\?|$)/i) || contentType.includes("m4a") || contentType.includes("mp4")) {
      fileExt = "m4a";
    } else if (episode.audioUrl.match(/\.wav(\?|$)/i)) {
      fileExt = "wav";
    }

    const audioBuffer = await audioResponse.arrayBuffer();
    const audioData = new Uint8Array(audioBuffer);
    console.log("Downloaded audio size:", audioData.length, "bytes");

    const fileName = `${user.id}/${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from("sermons")
      .upload(fileName, audioData, {
        contentType: contentType.includes("audio") ? contentType : `audio/${fileExt}`,
        upsert: false,
      });

    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

    const sermonTitle = customTitle || episode.title;

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

    if (dbError) throw new Error(`Database insert failed: ${dbError.message}`);

    // Trigger transcription
    supabase.functions.invoke("transcribe-sermon", {
      body: { sermonId: sermon.id },
    }).catch(err => console.error("Transcription trigger failed:", err));

    return new Response(
      JSON.stringify({ success: true, sermon, episodeTitle: episode.title }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error processing podcast:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
