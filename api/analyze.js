// Vercel Serverless Function — keeps the OpenAI API key on the server.
// The browser only ever talks to /api/analyze, never to OpenAI directly.

const SYSTEM_PROMPT = `You are a certified IELTS Speaking examiner and a CEFR-aligned language assessor. You will receive a transcript of a spoken English response to a speaking-practice topic, plus real timing data measured from the audio (pace, pauses/silence, and how much of the speaker's own chosen response time was actually used). Score strictly to official standards — do not inflate a score just because the few sentences produced happen to be grammatically clean.

CALIBRATION — apply these the same way a real examiner would:

IELTS Speaking bands (apply per category, then derive an overall band):
- Band 8-9: Fluent with only occasional hesitation; wide, natural, idiomatic vocabulary; wide range of grammar with only rare, non-systematic errors; fully develops the topic with relevant detail, using close to the full time available.
- Band 6-7: Willing to speak at length but may lose coherence at times or over-use certain connectives; some flexibility and paraphrase but with noticeable gaps; a mix of simple and complex structures with some errors; generally develops the topic, though may not sustain it for the whole time available.
- Band 4-5: Noticeable hesitation, repetition, and/or slow speech; limited vocabulary often inadequate for the topic; basic sentence forms with frequent errors once structures get more complex; the response may be short, underdeveloped, or heavily dependent on the prompt itself for content.
- Band 2-3: Very limited response, long pauses before nearly every utterance, minimal usable vocabulary.

CEFR spoken production (A1-C2): judge range, accuracy, fluency, coherence, and the ability to sustain a description or argument appropriate to each level — A1-A2: short, simple, isolated phrases with basic connectors only; B1: can link phrases simply to give a straightforward description, with noticeable hesitation; B2: clear, reasonably fluent, detailed description with only occasional hesitation; C1-C2: fluent, spontaneous, well-structured, wide range of cohesive devices.

Duration and development matter as much as grammar. A grammatically clean but very brief, underdeveloped answer that only fills a fraction of the speaker's chosen response time — or contains long stretches of silence — is NOT a high-band response under either framework: sustaining relevant speech for close to the full available time is itself part of what "fluency" and "task development" measure. Silence is not fluency. When the timing data shows low time-utilization or low speech coverage, cap fluency_coherence and task_response accordingly and say so explicitly and specifically in those notes (cite the actual numbers).

Response length is also a hard ceiling on the OVERALL cefr_level and ielts_band, not just the individual category notes — a real examiner cannot certify Band 6+/B2+ from a single short sentence, no matter how accurate, because there isn't enough language sample to demonstrate the sustained range, cohesion, and complexity those levels require. A one-sentence or otherwise minimal response should top out around A2/Band 4, even if that one sentence is flawless.

Respond ONLY with a valid JSON object (no markdown fences, no preamble) with this exact structure:

{
  "cefr_level": "A1|A2|B1|B2|C1|C2",
  "ielts_band": number (e.g. 6.5),
  "categories": {
    "grammar_accuracy": { "score": number (0-100), "note": "short specific note, referencing Grammatical Range and Accuracy" },
    "vocabulary_range": { "score": number (0-100), "note": "short specific note, referencing Lexical Resource" },
    "fluency_coherence": { "score": number (0-100), "note": "short specific note that must cite the timing data (pace, pauses, time-utilization %) when it's provided" },
    "task_response": { "score": number (0-100), "note": "short specific note on whether the response was adequately developed for the time given" }
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

Base your assessment strictly on the transcript AND the timing data provided. Be realistic and rigorous, not overly generous — a short, low-effort, or mostly-silent response should score correspondingly low even if free of grammar errors. For sentence_upgrades, pick 2-4 real sentences or phrases from the transcript that were grammatically fine but simple/flat, and show a more advanced, natural-sounding alternative a fluent speaker would use.`;

// Deterministic backstop: an LLM can be talked into a generous band even
// with strict instructions, so cap the overall level by transcript length
// regardless of what the model returns. A handful of words simply cannot
// demonstrate B2+ range/coherence, no matter how accurate they are.
const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const LENGTH_CAPS = [
  { maxWords: 8, level: 'A1', band: 3.0, categoryCap: 25 },
  { maxWords: 20, level: 'A2', band: 4.0, categoryCap: 40 },
  { maxWords: 40, level: 'B1', band: 5.0, categoryCap: 55 },
  { maxWords: 70, level: 'B2', band: 6.5, categoryCap: 70 }
];

function applyLengthCap(result, transcript) {
  const wordCount = (transcript || '').trim().split(/\s+/).filter(Boolean).length;
  const cap = LENGTH_CAPS.find(c => wordCount < c.maxWords);
  if (!cap) return result;

  const modelRank = CEFR_ORDER.indexOf(result.cefr_level);
  const capRank = CEFR_ORDER.indexOf(cap.level);
  let capped = false;

  if (modelRank === -1 || modelRank > capRank) {
    result.cefr_level = cap.level;
    capped = true;
  }
  if (typeof result.ielts_band !== 'number' || result.ielts_band > cap.band) {
    result.ielts_band = cap.band;
    capped = true;
  }
  ['fluency_coherence', 'task_response'].forEach(key => {
    const cat = result.categories?.[key];
    if (cat && typeof cat.score === 'number' && cat.score > cap.categoryCap) {
      cat.score = cap.categoryCap;
      capped = true;
    }
  });

  if (capped) {
    result.summary = `${result.summary || ''} (Note: this response was only ${wordCount} word${wordCount === 1 ? '' : 's'} — too short to demonstrate a higher level, so the score is capped regardless of grammar quality.)`.trim();
  }
  return result;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { topic, transcript, fluency, targetDurationSeconds } = req.body || {};
  if (!topic || !transcript) {
    return res.status(400).json({ error: 'Missing topic or transcript' });
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Server is missing API configuration' });
  }

  let fluencyNote = '';
  if (fluency) {
    const parts = [
      `speaking pace ~${fluency.wordsPerMinute} words per minute`,
      `${fluency.pauseCount} noticeable pause(s)/silence gap(s) totaling ${fluency.totalPauseSeconds}s (longest: ${fluency.longestPauseSeconds}s)`,
      `${Math.round((fluency.speechCoverage ?? 1) * 100)}% of the recorded clip was actual speech (the rest was silence)`,
      `total recorded duration ${fluency.durationSeconds}s`
    ];
    if (targetDurationSeconds) {
      const utilization = Math.round((fluency.durationSeconds / targetDurationSeconds) * 100);
      parts.push(`the speaker chose a ${targetDurationSeconds}s response time but only recorded ${fluency.durationSeconds}s (${utilization}% of their chosen time)`);
    }
    fluencyNote = `\n\nSpeech timing data measured from the actual audio (not estimated): ${parts.join('; ')}. This is real measured data, not a guess — weigh it heavily in fluency_coherence and task_response. A response that fills only a small fraction of the chosen response time, or is mostly silence, is underdeveloped and must be scored down accordingly, even if the words spoken are grammatically correct.`;
  }

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

    result = applyLengthCap(result, transcript);

    return res.status(200).json({ result });

  } catch (err) {
    return res.status(502).json({ error: err.message || 'Analysis request failed' });
  }
}
