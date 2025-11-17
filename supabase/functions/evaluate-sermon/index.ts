import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sermonId, ruleIds } = await req.json();

    if (!sermonId || !ruleIds || ruleIds.length === 0) {
      throw new Error('Missing sermonId or ruleIds');
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    // Get the user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    // Fetch sermon sentences grouped into paragraphs
    const { data: sentences, error: sentencesError } = await supabaseClient
      .from('sermon_sentences')
      .select('*')
      .eq('sermon_id', sermonId)
      .order('order_index', { ascending: true });

    if (sentencesError) throw sentencesError;
    if (!sentences || sentences.length === 0) {
      throw new Error('No sentences found for sermon');
    }

    // Group sentences into paragraphs (5 sentences each)
    const paragraphs = [];
    for (let i = 0; i < sentences.length; i += 5) {
      const paragraphSentences = sentences.slice(i, i + 5);
      paragraphs.push({
        text: paragraphSentences.map(s => s.sentence_text).join(' '),
        start_time_ms: paragraphSentences[0].start_time_ms,
        end_time_ms: paragraphSentences[paragraphSentences.length - 1].end_time_ms,
      });
    }

    // Fetch evaluation rules
    const { data: rules, error: rulesError } = await supabaseClient
      .from('evaluation_rules')
      .select('*')
      .in('id', ruleIds);

    if (rulesError) throw rulesError;
    if (!rules || rules.length === 0) {
      throw new Error('No rules found');
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    // Process each rule
    const allComments = [];
    
    for (const rule of rules) {
      console.log(`Processing rule: ${rule.name}`);

      // Create prompt for OpenAI
      const systemPrompt = `You are evaluating a sermon transcript based on specific criteria. 
Your task is to identify paragraphs that match the evaluation rule and provide insightful comments.
Return ONLY a JSON array of objects with this exact structure:
[{"paragraph_index": <number>, "comment": "<your comment>"}]

If no paragraphs match the criteria, return an empty array: []`;

      const userPrompt = `Evaluation Rule: ${rule.name}
Description: ${rule.description}
Specific Instructions: ${rule.prompt}

Sermon Transcript (divided into paragraphs):
${paragraphs.map((p, i) => `[Paragraph ${i}] ${p.text}`).join('\n\n')}

Identify paragraphs that match this rule and provide comments. Return ONLY valid JSON.`;

      // Call OpenAI API
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`OpenAI API error for rule ${rule.name}:`, response.status, errorText);
        continue;
      }

      const data = await response.json();
      const aiResponse = data.choices[0].message.content;

      console.log(`AI response for rule ${rule.name}:`, aiResponse);

      // Parse AI response
      try {
        const matches = JSON.parse(aiResponse);
        
        for (const match of matches) {
          if (match.paragraph_index >= 0 && match.paragraph_index < paragraphs.length) {
            const paragraph = paragraphs[match.paragraph_index];
            allComments.push({
              sermon_id: sermonId,
              user_id: user.id,
              rule_id: rule.id,
              start_time_ms: paragraph.start_time_ms,
              end_time_ms: paragraph.end_time_ms,
              comment_text: match.comment,
            });
          }
        }
      } catch (parseError) {
        console.error(`Failed to parse AI response for rule ${rule.name}:`, parseError);
        continue;
      }
    }

    // Insert all comments in batch
    if (allComments.length > 0) {
      const { error: insertError } = await supabaseClient
        .from('sermon_comments')
        .insert(allComments);

      if (insertError) throw insertError;
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        commentsCreated: allComments.length 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in evaluate-sermon:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});