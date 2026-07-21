// Vercel Serverless Function — forwards recorded audio to OpenAI Whisper.
// The browser posts the raw audio blob here; this route attaches the OpenAI
// key server-side and returns just the transcribed text.

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Derive pacing/pause metrics from Whisper's segment timestamps — real timing
// data from the audio, as opposed to guessing fluency from the text alone.
const PAUSE_THRESHOLD_SECONDS = 0.6;

function computeFluency(data) {
  const duration = data.duration || 0;
  const wordCount = (data.text || '').trim().split(/\s+/).filter(Boolean).length;
  const wordsPerMinute = duration > 0 ? Math.round((wordCount / duration) * 60) : 0;

  const segments = data.segments || [];
  let pauseCount = 0;
  let totalPauseSeconds = 0;
  let longestPauseSeconds = 0;
  for (let i = 1; i < segments.length; i++) {
    const gap = segments[i].start - segments[i - 1].end;
    if (gap > PAUSE_THRESHOLD_SECONDS) {
      pauseCount++;
      totalPauseSeconds += gap;
      longestPauseSeconds = Math.max(longestPauseSeconds, gap);
    }
  }

  return {
    durationSeconds: Math.round(duration * 10) / 10,
    wordsPerMinute,
    pauseCount,
    totalPauseSeconds: Math.round(totalPauseSeconds * 10) / 10,
    longestPauseSeconds: Math.round(longestPauseSeconds * 10) / 10
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Server is missing API configuration' });
  }

  const audioBuffer = await readRawBody(req);
  if (!audioBuffer.length) {
    return res.status(400).json({ error: 'No audio received' });
  }

  const contentType = req.headers['content-type'] || 'audio/webm';

  try {
    const form = new FormData();
    form.append('file', new Blob([audioBuffer], { type: contentType }), 'recording.webm');
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');

    const upstream = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: form
    });

    if (!upstream.ok) {
      throw new Error(`Transcription API returned status ${upstream.status}`);
    }

    const data = await upstream.json();
    return res.status(200).json({
      text: (data.text || '').trim(),
      fluency: computeFluency(data)
    });

  } catch (err) {
    return res.status(502).json({ error: err.message || 'Transcription request failed' });
  }
}
