import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Extract short code from a Subsplash URL.
 * Handles both subspla.sh/<code> and subsplash.com/.../d/<code> patterns.
 */
function getSubsplashShortCode(url: string): string | null {
  try {
    const parsed = new URL(url);
    // https://<anything>.subspla.sh/<code>  or  https://subspla.sh/<code>
    if (parsed.hostname.endsWith("subspla.sh")) {
      const code = parsed.pathname.replace(/^\//, "").split("/")[0];
      return code || null;
    }
    // https://subsplash.com/u/<org>/media/d/<code>
    const match = parsed.pathname.match(/\/(?:d\/|mi\/\+)(\w+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Fetch media info from the Subsplash Core API.
 * Steps: 1) visit the share page to grab a guest token, 2) call the media-items API.
 */
async function fetchSubsplashAudio(shortCode: string, originalUrl: string) {
  // Step 1 – get a guest auth token by visiting the canonical page
  const canonicalUrl = `https://subsplash.com/+${shortCode}`;
  // Try with the share-link domain first (it will redirect to subsplash.com)
  const pageRes = await fetch(`https://subspla.sh/${shortCode}`, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SermonDownloader/1.0)" },
  });
  const pageHtml = await pageRes.text();

  // Extract guest token from the HTML (shoebox-tokens JSON or regex in script)
  let token: string | null = null;

  // Method 1: shoebox-tokens element
  const shoeboxMatch = pageHtml.match(/id="shoebox-tokens"[^>]*>(.*?)<\/script/s);
  if (shoeboxMatch) {
    try {
      const shoeboxData = JSON.parse(shoeboxMatch[1]);
      token = shoeboxData.apiToken || null;
    } catch { /* ignore parse error */ }
  }

  // Method 2: regex in inline script
  if (!token) {
    const tokenMatch = pageHtml.match(/"tokens":\s*{\s*"guest"\s*:\s*"([A-Za-z0-9._-]+)"/);
    token = tokenMatch ? tokenMatch[1] : null;
  }

  // Method 3: check cookies from response
  if (!token) {
    const cookies = pageRes.headers.get("set-cookie") || "";
    const cookieMatch = cookies.match(/ss-token-guest=([A-Za-z0-9._-]+)/);
    token = cookieMatch ? cookieMatch[1] : null;
  }

  if (!token) {
    console.error("Could not extract Subsplash auth token from page");
    throw new Error("Could not authenticate with Subsplash. The share link may be invalid or expired.");
  }

  // Step 2 – call the media-items API
  const apiUrl = `https://core.subsplash.com/media/v1/media-items?filter[short_code]=${shortCode}&include=images,audio.audio-outputs,audio.video,video.video-outputs,video.playlists,document,broadcast`;

  const apiRes = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!apiRes.ok) {
    const errText = await apiRes.text();
    console.error("Subsplash API error:", apiRes.status, errText);
    throw new Error(`Subsplash API returned ${apiRes.status}`);
  }

  const apiData = await apiRes.json();
  const mediaItem = apiData?._embedded?.["media-items"]?.[0];

  if (!mediaItem) {
    throw new Error("No media item found for this Subsplash link");
  }

  const title = mediaItem.title || "Subsplash Audio";

  // Extract audio outputs
  const audioOutputs = mediaItem?._embedded?.audio?._embedded?.["audio-outputs"] || [];
  const audioLinks: { url: string; name: string }[] = [];

  for (const output of audioOutputs) {
    const audioUrl = output?._links?.related?.href;
    if (audioUrl) {
      audioLinks.push({
        url: audioUrl,
        name: `${title} (${output.format || "audio"})`,
      });
    }
  }

  // Also check for video sources (some sermons are video-only)
  const videoOutputs = mediaItem?._embedded?.video?._embedded?.["video-outputs"] || [];
  for (const output of videoOutputs) {
    const videoUrl = output?._links?.related?.href;
    if (videoUrl) {
      audioLinks.push({
        url: videoUrl,
        name: `${title} (video - ${output.width}x${output.height})`,
      });
    }
  }

  // Check for HLS playlist
  const playlists = mediaItem?._embedded?.video?._embedded?.playlists || [];
  for (const playlist of playlists) {
    const hlsUrl = playlist?._links?.related?.href;
    if (hlsUrl) {
      audioLinks.push({
        url: hlsUrl,
        name: `${title} (HLS stream)`,
      });
    }
  }

  return { audioLinks, title };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let { url } = await req.json();

    if (!url) {
      throw new Error("URL is required");
    }

    // Check if this is a Subsplash URL – use direct API instead of Firecrawl
    const subsplashCode = getSubsplashShortCode(url);
    if (subsplashCode) {
      console.log("Detected Subsplash URL, using direct API. Short code:", subsplashCode);
      const { audioLinks, title } = await fetchSubsplashAudio(subsplashCode, url);

      console.log(`Found ${audioLinks.length} audio links from Subsplash API`);

      return new Response(
        JSON.stringify({
          success: true,
          audioLinks,
          potentialAudioLinks: [],
          pageTitle: title,
          totalLinksScanned: audioLinks.length,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Non-Subsplash URL – use Firecrawl as before
    const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!apiKey) {
      throw new Error("Firecrawl connector not configured");
    }

    console.log("Scraping page for audio links:", url);

    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["links", "markdown"],
        onlyMainContent: false,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Firecrawl API error:", data);
      throw new Error(data.error || `Firecrawl request failed: ${response.status}`);
    }

    const allLinks: string[] = data.data?.links || data.links || [];
    const markdown: string = data.data?.markdown || data.markdown || "";
    const markdownUrls = markdown.match(/https?:\/\/[^\s"'<>\]]+/g) || [];
    const combinedLinks = [...new Set([...allLinks, ...markdownUrls])];

    const audioExtensions = /\.(mp3|wav|m4a|aac|ogg|flac)(\?[^"'\s]*)?$/i;
    const audioContentIndicators = /\b(audio|podcast|sermon|episode|media|download|listen)\b/i;

    const audioLinks = combinedLinks
      .filter((link) => audioExtensions.test(link))
      .map((link) => {
        try {
          const urlPath = new URL(link).pathname;
          const filename = decodeURIComponent(
            urlPath.split("/").pop()?.replace(/\.[^/.]+$/, "") || "Unknown"
          );
          return { url: link, name: filename };
        } catch {
          return { url: link, name: "Audio file" };
        }
      });

    const potentialAudioLinks = combinedLinks
      .filter(
        (link) =>
          !audioExtensions.test(link) &&
          audioContentIndicators.test(link) &&
          !link.includes("javascript:") &&
          !link.includes("#")
      )
      .slice(0, 5)
      .map((link) => {
        try {
          const urlPath = new URL(link).pathname;
          const filename = decodeURIComponent(
            urlPath.split("/").filter(Boolean).pop() || "Unknown"
          );
          return { url: link, name: filename, potential: true };
        } catch {
          return { url: link, name: "Possible audio", potential: true };
        }
      });

    const pageTitle = data.data?.metadata?.title || data.metadata?.title || "";

    console.log(
      `Found ${audioLinks.length} audio links and ${potentialAudioLinks.length} potential audio links`
    );

    return new Response(
      JSON.stringify({
        success: true,
        audioLinks,
        potentialAudioLinks,
        pageTitle,
        totalLinksScanned: combinedLinks.length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error scraping audio links:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
