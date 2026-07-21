// Vercel Serverless Function — keeps the OpenAI API key on the server.
// The browser only ever talks to /api/analyze, never to OpenAI directly.

const SYSTEM_PROMPT = `You are a certified English language examiner trained in CEFR and IELTS speaking assessment frameworks. You will receive a transcript of a spoken English response to a small-talk topic. Analyze it and respond ONLY with a valid JSON object (no markdown fences, no preamble) with this exact structure:

{
  "cefr_level": "A1|A2|B1|B2|C1|C2",
  "ielts_band": number (e.g. 6.5),
  "categories": {
    "grammar_accuracy": { "score": number (0-100), "note": "short specific note" },
    "vocabulary_range": { "score": number (0-100), "note": "short specific note" },
    "fluency_coherence": { "score": number (0-100), "note": "short specific note, citing the speech timing data (pace, pauses) when it's provided" },
    "task_response": { "score": number (0-100), "note": "short specific note" }
  },
  "strengths": ["short point 1", "short point 2"],
  "areas_to_improve": ["short point 1", "short point 2", "short point 3"],
  "corrected_examples": [
    { "original": "phrase from transcript with an error", "corrected": "corrected version", "explanation": "brief why" }
  ],
  "sentence_upgrades": [
    { "said": "a simple or plain sentence the speaker actually used", "better": "a more natural, fluent, higher-level way a proficient speaker might phrase the same idea", "why": "brief explanation of what makes the upgraded version better (word choice, structure, idiom, etc)" }
  ],
  "summary": "2-3 sentence overall feedback in an encouraging but honest tone"
}

Base your assessment strictly on the transcript provided. Be realistic, not overly generous. This is a casual small-talk response, so calibrate expectations accordingly but still assess genuine language ability shown. For sentence_upgrades, pick 2-4 real sentences or phrases from the transcript that were grammatically fine but simple/flat, and show a more advanced, natural-sounding alternative a fluent speaker would use — focus on elevating vocabulary and phrasing, not just fixing errors.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { topic, transcript, fluency } = req.body || {};
  if (!topic || !transcript) {
    return res.status(400).json({ error: 'Missing topic or transcript' });
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Server is missing API configuration' });
  }

  const fluencyNote = fluency
    ? `\n\nSpeech timing data measured from the actual audio (not estimated): speaking pace ~${fluency.wordsPerMinute} words per minute, ${fluency.pauseCount} noticeable pause(s) totaling ${fluency.totalPauseSeconds}s (longest single pause: ${fluency.longestPauseSeconds}s), total speaking duration ${fluency.durationSeconds}s. Use this real timing data, not just sentence structure, to inform the fluency_coherence score and note.`
    : '';

  const userPrompt = `Topic given to the speaker: "${topic}"

Transcript of their spoken response:
"${transcript}"${fluencyNote}

Provide the JSON assessment now.`;

  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.4,
        response_format: { type: 'json_object' }
      })
    });

    if (!upstream.ok) {
      throw new Error(`API returned status ${upstream.status}`);
    }

    const data = await upstream.json();
    let content = data.choices?.[0]?.message?.content || '';
    content = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');

    let result;
    try {
      result = JSON.parse(content);
    } catch (parseErr) {
      return res.status(502).json({ error: 'Could not parse the analysis response. Please try again.' });
    }

    return res.status(200).json({ result });

  } catch (err) {
    return res.status(502).json({ error: err.message || 'Analysis request failed' });
  }
}
