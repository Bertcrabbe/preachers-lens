import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let { url } = await req.json();

    if (!url) {
      throw new Error("URL is required");
    }

    const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!apiKey) {
      throw new Error("Firecrawl connector not configured");
    }

    // Subsplash short links use DNS-invalid subdomains (leading hyphens).
    // Strip the subdomain — the path alone resolves on subspla.sh.
    try {
      const parsed = new URL(url);
      if (parsed.hostname.endsWith("subspla.sh") && parsed.hostname !== "subspla.sh") {
        const fixedUrl = `https://subspla.sh${parsed.pathname}${parsed.search}${parsed.hash}`;
        console.log("Rewrote Subsplash URL:", url, "→", fixedUrl);
        url = fixedUrl;
      }
    } catch { /* keep original url */ }

    console.log("Scraping page for audio links:", url);

    // Use Firecrawl to scrape the page for links
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

    // Extract audio links from both the links array and markdown content
    const allLinks: string[] = data.data?.links || data.links || [];
    const markdown: string = data.data?.markdown || data.markdown || "";

    // Also extract URLs from markdown that might be audio files
    const markdownUrls = markdown.match(/https?:\/\/[^\s"'<>\]]+/g) || [];
    const combinedLinks = [...new Set([...allLinks, ...markdownUrls])];

    // Filter for audio file links
    const audioExtensions = /\.(mp3|wav|m4a|aac|ogg|flac)(\?[^"'\s]*)?$/i;
    const audioContentIndicators = /\b(audio|podcast|sermon|episode|media|download|listen)\b/i;
    
    const audioLinks = combinedLinks
      .filter((link) => audioExtensions.test(link))
      .map((link) => {
        // Try to extract a readable name from the URL
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

    // Also find potential audio links (links that might lead to audio but don't have extensions)
    const potentialAudioLinks = combinedLinks
      .filter(
        (link) =>
          !audioExtensions.test(link) &&
          audioContentIndicators.test(link) &&
          !link.includes("javascript:") &&
          !link.includes("#")
      )
      .slice(0, 5) // Limit potential links
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
