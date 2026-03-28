import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { sermonId } = await req.json();

    if (!sermonId) {
      throw new Error('Sermon ID is required');
    }

    console.log('Fetching comments for sermon:', sermonId);

    // Fetch all comments (both text and audio) for this sermon
    const { data: comments, error: commentsError } = await supabase
      .from('sermon_comments')
      .select('*, evaluation_rules(name, description)')
      .eq('sermon_id', sermonId)
      .order('start_time_ms');

    if (commentsError) {
      console.error('Error fetching comments:', commentsError);
      throw commentsError;
    }

    console.log(`Found ${comments?.length || 0} comments`);

    if (!comments || comments.length === 0) {
      return new Response(
        JSON.stringify({ 
          summary: "No comments found for this sermon yet. Add comments to generate a summary.",
          bulletPoints: []
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Format comments for AI analysis
    const commentTexts = comments.map((comment: any, index: number) => {
      const timeStamp = `[${Math.floor(comment.start_time_ms / 1000 / 60)}:${String(Math.floor((comment.start_time_ms / 1000) % 60)).padStart(2, '0')}]`;
      const ruleContext = comment.evaluation_rules 
        ? `(${comment.evaluation_rules.name}: ${comment.evaluation_rules.description})` 
        : '';
      const commentType = comment.audio_url ? '[Audio Comment]' : '[Text Comment]';
      return `${index + 1}. ${timeStamp} ${commentType} ${ruleContext}\n   ${comment.comment_text || 'Audio feedback provided'}`;
    }).join('\n\n');

    const prompt = `You are an expert sermon coach analyzing feedback on a sermon. Below are all the comments (both written and audio) that have been added to this sermon at various timestamps.

Comments:
${commentTexts}

Based on these comments, provide:
1. A brief summary (2-3 sentences) of the overall feedback
2. 3-5 specific, actionable bullet points on how the sermon could be improved

Format your response as JSON:
{
  "summary": "Your summary here",
  "bulletPoints": ["Point 1", "Point 2", "Point 3"]
}

Focus on constructive, specific recommendations that the speaker can act on.`;

    console.log('Calling Lovable AI for summary...');

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are a helpful sermon coach. Always respond with valid JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errorText);
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No content in AI response');
    }

    console.log('AI response received:', content);

    // Parse the JSON response - strip markdown code blocks if present
    let result;
    try {
      let jsonStr = content.trim();
      
      // Remove markdown code blocks if present
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      result = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', content);
      // Fallback: try to extract summary and bullet points from text
      result = {
        summary: content.substring(0, 300),
        bulletPoints: ["Unable to parse structured recommendations. Please review comments manually."]
      };
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in summarize-comments function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
