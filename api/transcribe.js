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
    return res.status(200).json({ text: (data.text || '').trim() });

  } catch (err) {
    return res.status(502).json({ error: err.message || 'Transcription request failed' });
  }
}
