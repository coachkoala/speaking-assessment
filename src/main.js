import './style.css';

// ---------- Speaking types & topic pools ----------
const speakingTypes = [
  {
    id: "personal",
    emoji: "💬",
    title: "Personal",
    description: "Talk about yourself and your daily life.",
    topics: [
      "Tell me about your family.",
      "What do you do for work or study?",
      "Describe your hometown.",
      "What hobbies do you enjoy in your free time?",
      "What does a typical day look like for you?"
    ]
  },
  {
    id: "story",
    emoji: "📖",
    title: "Story",
    description: "Describe a person, place, object, or experience.",
    topics: [
      "Describe a memorable trip you've taken.",
      "Tell me about your favorite teacher.",
      "Describe a useful object you own.",
      "Tell me about an unforgettable event in your life."
    ]
  },
  {
    id: "opinion",
    emoji: "💡",
    title: "Opinion",
    description: "Share your ideas and explain your reasons.",
    topics: [
      "Should AI be used in schools? Why or why not?",
      "Do you think public transportation is important? Why?",
      "Why do you think people enjoy traveling?",
      "How has technology changed the way people communicate?"
    ]
  }
];

const responseTimes = [30, 60, 120];

let currentTopic = "";
let selectedTypeId = speakingTypes[0].id;
let currentSpeakingType = speakingTypes[0];
let selectedDuration = 60;
let mediaRecorder = null;
let audioChunks = [];
let audioBlobUrl = null;
let finalTranscript = "";
let fluencyMetrics = null;
let timerInterval = null;
let countdownInterval = null;
let timeLeft = 60;
let recording = false;
let inCountdown = false;

const setupCard = document.getElementById('setupCard');
const practiceCard = document.getElementById('practiceCard');
const typeList = document.getElementById('typeList');
const startPracticeBtn = document.getElementById('startPracticeBtn');
const backToSetupBtn = document.getElementById('backToSetupBtn');
const questionText = document.getElementById('questionText');
const newTopicBtn = document.getElementById('newTopicBtn');
const retryTopicBtn = document.getElementById('retryTopicBtn');
const durationSelect = document.getElementById('durationSelect');
const timerDisplay = document.getElementById('timerDisplay');
const timerLabel = document.getElementById('timerLabel');
const wave = document.getElementById('wave');
const stageEl = document.getElementById('stage');
const recordBtn = document.getElementById('recordBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const transcriptBox = document.getElementById('transcriptBox');
const audioArea = document.getElementById('audioArea');
const analyzeBtn = document.getElementById('analyzeBtn');
const errorArea = document.getElementById('errorArea');
const loadingArea = document.getElementById('loadingArea');
const reportArea = document.getElementById('reportArea');
const shareOverlay = document.getElementById('shareOverlay');
const shareCardCanvas = document.getElementById('shareCardCanvas');
const shareCloseBtn = document.getElementById('shareCloseBtn');
const shareDownloadBtn = document.getElementById('shareDownloadBtn');
const shareSendBtn = document.getElementById('shareSendBtn');

document.getElementById('sessionNum').textContent = 'REF-' + Math.random().toString(36).slice(2,8).toUpperCase();

// ---------- Setup: speaking type + response time ----------
function renderTypeList(){
  typeList.innerHTML = speakingTypes.map(t => `
    <button type="button" class="type-card${t.id === selectedTypeId ? ' active' : ''}" data-type="${t.id}">
      <span class="type-emoji">${t.emoji}</span>
      <span class="type-info">
        <span class="type-title">${escapeHtml(t.title)}</span>
        <span class="type-desc">${escapeHtml(t.description)}</span>
      </span>
    </button>
  `).join('');
}

function renderDurationOptions(){
  durationSelect.innerHTML = responseTimes.map(d => `
    <button type="button" class="dur-opt${d === selectedDuration ? ' active' : ''}" data-dur="${d}">${d}s</button>
  `).join('');
}

typeList.addEventListener('click', (e) => {
  const card = e.target.closest('.type-card');
  if (!card) return;
  selectedTypeId = card.dataset.type;
  renderTypeList();
});

durationSelect.addEventListener('click', (e) => {
  const btn = e.target.closest('.dur-opt');
  if (!btn) return;
  selectedDuration = parseInt(btn.dataset.dur, 10);
  renderDurationOptions();
});

startPracticeBtn.addEventListener('click', () => {
  currentSpeakingType = speakingTypes.find(t => t.id === selectedTypeId) || speakingTypes[0];
  pickTopic(false);
  setupCard.hidden = true;
  practiceCard.hidden = false;
  practiceCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

backToSetupBtn.addEventListener('click', () => {
  if (recording || inCountdown) return;
  practiceCard.hidden = true;
  setupCard.hidden = false;
  setupCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---------- Topic selection ----------
function pickTopic(isRetry){
  if (!isRetry) {
    const pool = currentSpeakingType.topics;
    let t = pool[Math.floor(Math.random() * pool.length)];
    if (t === currentTopic && pool.length > 1) {
      while (t === currentTopic) t = pool[Math.floor(Math.random() * pool.length)];
    }
    currentTopic = t;
  }
  questionText.classList.add('swap');
  setTimeout(() => {
    questionText.textContent = currentTopic;
    questionText.classList.remove('swap');
  }, 150);
  resetSession();
}
newTopicBtn.addEventListener('click', () => pickTopic(false));
retryTopicBtn.addEventListener('click', () => pickTopic(true));

function resetSession(){
  finalTranscript = "";
  fluencyMetrics = null;
  transcriptBox.textContent = "Your transcript will appear here after you finish recording.";
  transcriptBox.classList.add('empty');
  analyzeBtn.disabled = true;
  reportArea.innerHTML = "";
  errorArea.innerHTML = "";
  audioArea.innerHTML = "";
  if (audioBlobUrl) { URL.revokeObjectURL(audioBlobUrl); audioBlobUrl = null; }
  timeLeft = selectedDuration;
  timerDisplay.textContent = timeLeft;
  timerLabel.textContent = "seconds ready";
  stageEl.classList.remove('is-countdown', 'is-recording');
  setStatus('idle', 'Idle — press Start Recording when ready');
}

function setStatus(kind, text){
  statusDot.className = 'dot' + (kind === 'rec' ? ' rec' : kind === 'done' ? ' done' : kind === 'wait' ? ' wait' : '');
  statusText.textContent = text;
}

// ---------- Countdown before recording ----------
function beginCountdown(){
  if (!currentTopic) {
    errorArea.innerHTML = `<div class="error-box">Please click "New Topic" first to get a question.</div>`;
    return;
  }

  errorArea.innerHTML = "";
  inCountdown = true;
  recordBtn.disabled = true;
  newTopicBtn.disabled = true;
  retryTopicBtn.disabled = true;
  backToSetupBtn.disabled = true;
  stageEl.classList.add('is-countdown');
  let count = 3;
  timerDisplay.textContent = count;
  timerLabel.textContent = "get ready...";
  setStatus('wait', 'Recording starts shortly — take a breath');

  countdownInterval = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(countdownInterval);
      stageEl.classList.remove('is-countdown');
      inCountdown = false;
      startRecording();
    } else {
      timerDisplay.textContent = count;
    }
  }, 800);
}

async function startRecording(){
  errorArea.innerHTML = "";
  finalTranscript = "";
  fluencyMetrics = null;
  audioChunks = [];
  transcriptBox.classList.remove('empty');
  transcriptBox.textContent = "Recording...";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
    mediaRecorder.onstop = () => {
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      audioBlobUrl = URL.createObjectURL(blob);
      audioArea.innerHTML = `
        <div class="audio-playback">
          <span class="lbl">Your recording</span>
          <audio controls src="${audioBlobUrl}"></audio>
        </div>
      `;
      transcribeAudio(blob);
    };
    mediaRecorder.start();
  } catch(err) {
    errorArea.innerHTML = `<div class="error-box">Microphone access was denied or unavailable. Please allow microphone access and try again.</div>`;
    recordBtn.disabled = false;
    newTopicBtn.disabled = false;
    retryTopicBtn.disabled = false;
    backToSetupBtn.disabled = false;
    return;
  }

  recording = true;
  timeLeft = selectedDuration;
  timerDisplay.textContent = timeLeft;
  timerLabel.textContent = "seconds remaining";
  wave.classList.remove('idle');
  stageEl.classList.add('is-recording');
  stopBtn.disabled = false;
  analyzeBtn.disabled = true;
  setStatus('rec', 'Recording — speak naturally about the topic');

  timerInterval = setInterval(() => {
    timeLeft--;
    timerDisplay.textContent = timeLeft;
    if (timeLeft <= 0) {
      finishRecording();
    }
  }, 1000);
}

function finishRecording(){
  if (!recording) return;
  recording = false;
  clearInterval(timerInterval);
  wave.classList.add('idle');
  stageEl.classList.remove('is-recording');

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
  }

  recordBtn.disabled = false;
  stopBtn.disabled = true;
  newTopicBtn.disabled = false;
  retryTopicBtn.disabled = false;
  backToSetupBtn.disabled = false;
  timerLabel.textContent = "seconds — done";

  setStatus('wait', 'Transcribing your recording...');
  transcriptBox.classList.add('empty');
  transcriptBox.textContent = "Transcribing...";
  analyzeBtn.disabled = true;
}

// ---------- Transcription ----------
// The OpenAI API key lives server-side in /api/transcribe — never sent to the browser.
async function transcribeAudio(blob){
  try {
    const response = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'audio/webm' },
      body: blob
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Request failed with status ${response.status}`);
    }

    const finalText = (data.text || '').trim();
    finalTranscript = finalText;
    fluencyMetrics = data.fluency || null;

    if (finalText.length < 5) {
      setStatus('idle', 'No speech detected — try again');
      transcriptBox.classList.add('empty');
      transcriptBox.textContent = "No speech was captured. Please try recording again.";
      analyzeBtn.disabled = true;
    } else {
      setStatus('done', 'Recording complete — ready to analyze');
      transcriptBox.classList.remove('empty');
      transcriptBox.textContent = finalText;
      analyzeBtn.disabled = false;
    }
  } catch(err) {
    setStatus('idle', 'Transcription failed — try again');
    errorArea.innerHTML = `<div class="error-box">Transcription failed: ${err.message}. Please check your connection and try again.</div>`;
    transcriptBox.classList.add('empty');
    transcriptBox.textContent = "Transcription failed.";
    analyzeBtn.disabled = true;
  }
}

recordBtn.addEventListener('click', beginCountdown);
stopBtn.addEventListener('click', finishRecording);

// ---------- Analysis ----------
// API key / base URL / model live server-side in /api/analyze — never sent to the browser.
analyzeBtn.addEventListener('click', async () => {
  const transcript = finalTranscript.trim();
  if (!transcript) return;

  errorArea.innerHTML = "";
  reportArea.innerHTML = "";
  analyzeBtn.disabled = true;
  loadingArea.innerHTML = `<div class="loading-line"><span class="spinner"></span> Analyzing your speaking sample...</div>`;

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: currentTopic, transcript, fluency: fluencyMetrics, targetDurationSeconds: selectedDuration })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Request failed with status ${response.status}`);
    }

    renderReport(data.result, transcript);
    setStatus('done', 'Analysis complete');

  } catch(err) {
    errorArea.innerHTML = `<div class="error-box">Analysis failed: ${err.message}. Please check your connection and try again.</div>`;
    analyzeBtn.disabled = false;
  } finally {
    loadingArea.innerHTML = "";
  }
});

const CEFR_TIERS = {
  A1: 'Beginner', A2: 'Elementary', B1: 'Intermediate',
  B2: 'Upper Intermediate', C1: 'Advanced', C2: 'Mastery'
};

function buildRadarChart(points){
  const size = 280;
  const center = size / 2;
  const maxR = 70;
  const labelOffset = 22;
  const n = points.length;
  const angleStep = (2 * Math.PI) / n;
  const startAngle = -Math.PI / 2;

  const coordAt = (i, r) => {
    const angle = startAngle + i * angleStep;
    return [center + r * Math.cos(angle), center + r * Math.sin(angle)];
  };

  const gridPolys = [0.25, 0.5, 0.75, 1].map(level => {
    const pts = points.map((_, i) => coordAt(i, maxR * level).join(',')).join(' ');
    return `<polygon class="radar-grid" points="${pts}" />`;
  }).join('');

  const axisLines = points.map((_, i) => {
    const [x, y] = coordAt(i, maxR);
    return `<line class="radar-axis" x1="${center}" y1="${center}" x2="${x}" y2="${y}" />`;
  }).join('');

  const shapePts = points.map((p, i) => coordAt(i, (p.value / 100) * maxR).join(',')).join(' ');
  const shape = `<polygon class="radar-shape" points="${shapePts}" />`;

  const labels = points.map((p, i) => {
    const [x, y] = coordAt(i, maxR + labelOffset);
    const anchor = Math.abs(x - center) < 4 ? 'middle' : (x > center ? 'start' : 'end');
    return `<text class="radar-label" x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle">${escapeHtml(p.label)}</text>`;
  }).join('');

  return `<svg class="radar-chart" viewBox="0 0 ${size} ${size}" style="overflow:visible">${gridPolys}${axisLines}${shape}${labels}</svg>`;
}

function renderReport(result, transcript){
  const cats = result.categories || {};
  const catKeys = [
    { key: 'grammar_accuracy', label: 'Grammar Accuracy', short: 'Grammar' },
    { key: 'vocabulary_range', label: 'Vocabulary Range', short: 'Vocab' },
    { key: 'fluency_coherence', label: 'Fluency & Coherence', short: 'Fluency' },
    { key: 'task_response', label: 'Task Response', short: 'Task' }
  ];

  const scores = catKeys.map(c => (cats[c.key] && cats[c.key].score) || 0);
  const overallScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const tierName = CEFR_TIERS[result.cefr_level] || '';
  const radarSvg = buildRadarChart(catKeys.map(c => ({ label: c.short, value: (cats[c.key] && cats[c.key].score) || 0 })));

  const pillarHtml = catKeys.map(c => {
    const d = cats[c.key] || { score: 0, note: '—' };
    return `
      <div class="pillar-row">
        <div class="pillar-label"><span>${c.label}</span><span class="pillar-score">${d.score}/100</span></div>
        <div class="pillar-track"><div class="pillar-fill" data-w="${d.score}" style="width:0%"></div></div>
        <div class="pillar-note">${escapeHtml(d.note)}</div>
      </div>
    `;
  }).join('');

  const topStrength = (result.strengths && result.strengths[0]) || 'Keep practicing to build your strengths.';
  const topFocus = (result.areas_to_improve && result.areas_to_improve[0]) || 'Keep practicing consistently.';

  const strengths = (result.strengths || []).map(s => `<li><span class="idx">+</span>${escapeHtml(s)}</li>`).join('');
  const improve = (result.areas_to_improve || []).map((s,i) => `<li><span class="idx">${i+1}.</span>${escapeHtml(s)}</li>`).join('');

  const corrections = (result.corrected_examples || []).map(c => `
    <div class="correction-item">
      <div class="orig">${escapeHtml(c.original)}</div>
      <div class="fix">${escapeHtml(c.corrected)}</div>
      <div class="why">${escapeHtml(c.explanation)}</div>
    </div>
  `).join('');

  const upgrades = (result.sentence_upgrades || []).map(u => `
    <div class="upgrade-item">
      <div class="said"><span>You said</span>${escapeHtml(u.said)}</div>
      <div class="better">${escapeHtml(u.better)}</div>
      <div class="why">${escapeHtml(u.why)}</div>
    </div>
  `).join('');

  reportArea.innerHTML = `
    <div class="report">
      <div class="score-hero">
        <div class="score-hero-main">
          <div class="score-big"><span class="num">${overallScore}</span><span class="denom">/100</span></div>
          <div class="score-tier">${escapeHtml(tierName)} <span class="tier-code">(${escapeHtml(result.cefr_level || '?')})</span></div>
          <div class="score-sub">IELTS Band ${result.ielts_band ?? '—'}</div>
        </div>
        <div class="radar-wrap">${radarSvg}</div>
      </div>

      <div class="pillar-list">${pillarHtml}</div>

      <div class="highlight-grid">
        <div class="highlight-card strength">
          <div class="highlight-label">Your Strength</div>
          <div class="highlight-text">${escapeHtml(topStrength)}</div>
        </div>
        <div class="highlight-card focus">
          <div class="highlight-label">Next Focus</div>
          <div class="highlight-text">${escapeHtml(topFocus)}</div>
        </div>
      </div>

      <div class="btn-row">
        <button class="btn secondary full" id="shareResultBtn">Create Share Card</button>
      </div>

      ${strengths ? `<div class="section-title">Strengths</div><ul class="feedback-list">${strengths}</ul>` : ''}
      ${improve ? `<div class="section-title">Areas to Improve</div><ul class="feedback-list">${improve}</ul>` : ''}
      ${corrections ? `<div class="section-title">Corrected Examples</div>${corrections}` : ''}
      ${upgrades ? `<div class="section-title">Better Ways to Say It</div>${upgrades}` : ''}

      <div class="section-title">Overall Feedback</div>
      <div class="report-text">${escapeHtml(result.summary || '')}</div>

      <div class="section-title">Full Transcript</div>
      <div class="full-transcript">${escapeHtml(transcript)}</div>
    </div>
  `;

  requestAnimationFrame(() => {
    setTimeout(() => {
      document.querySelectorAll('.pillar-fill').forEach(bar => {
        bar.style.width = bar.dataset.w + '%';
      });
    }, 50);
  });

  const shareBtn = document.getElementById('shareResultBtn');
  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      openShareCard({
        overallScore, tierName,
        cefrLevel: result.cefr_level || '?',
        ieltsBand: result.ielts_band,
        summary: result.summary || '',
        radarPoints: catKeys.map(c => ({ label: c.short, value: (cats[c.key] && cats[c.key].score) || 0 })),
        pillars: catKeys.map(c => ({
          label: c.label,
          score: (cats[c.key] && cats[c.key].score) || 0,
          note: (cats[c.key] && cats[c.key].note) || ''
        }))
      });
    });
  }

  reportArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function escapeHtml(str){
  if (typeof str !== 'string') return String(str ?? '');
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Share card (story-sized image for social sharing) ----------
function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncateText(ctx, text, maxWidth){
  text = text || '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines){
  const words = (text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const testLine = line ? line + ' ' + word : word;
    if (line && ctx.measureText(testLine).width > maxWidth) {
      lines.push(line);
      if (lines.length >= maxLines) break;
      line = word;
    } else {
      line = testLine;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  lines.slice(0, maxLines).forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
}

function paintCardBackground(ctx, W, H){
  ctx.fillStyle = '#05070F';
  ctx.fillRect(0, 0, W, H);

  const g1 = ctx.createRadialGradient(W * 0.15, H * 0.04, 0, W * 0.15, H * 0.04, W * 0.9);
  g1.addColorStop(0, 'rgba(47,92,255,0.30)');
  g1.addColorStop(1, 'rgba(47,92,255,0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, W, H);

  const g2 = ctx.createRadialGradient(W * 0.95, H * 0.1, 0, W * 0.95, H * 0.1, W * 0.7);
  g2.addColorStop(0, 'rgba(255,59,78,0.2)');
  g2.addColorStop(1, 'rgba(255,59,78,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);

  const g3 = ctx.createRadialGradient(W * 0.5, H * 1.02, 0, W * 0.5, H * 1.02, W * 1.0);
  g3.addColorStop(0, 'rgba(47,92,255,0.16)');
  g3.addColorStop(1, 'rgba(47,92,255,0)');
  ctx.fillStyle = g3;
  ctx.fillRect(0, 0, W, H);
}

function drawRadarCanvas(ctx, cx, cy, maxR, points){
  const n = points.length;
  const angleStep = (2 * Math.PI) / n;
  const startAngle = -Math.PI / 2;
  const coordAt = (i, r) => {
    const angle = startAngle + i * angleStep;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  };

  [0.25, 0.5, 0.75, 1].forEach(level => {
    ctx.beginPath();
    points.forEach((_, i) => {
      const [x, y] = coordAt(i, maxR * level);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  points.forEach((_, i) => {
    const [x, y] = coordAt(i, maxR);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  ctx.beginPath();
  points.forEach((p, i) => {
    const [x, y] = coordAt(i, (p.value / 100) * maxR);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = 'rgba(47,92,255,0.32)';
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#5B7FFF';
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.font = '600 28px "JetBrains Mono", monospace';
  ctx.fillStyle = 'rgba(237,239,247,0.55)';
  ctx.textBaseline = 'middle';
  points.forEach((p, i) => {
    const [x, y] = coordAt(i, maxR + 60);
    ctx.textAlign = Math.abs(x - cx) < 4 ? 'center' : (x > cx ? 'left' : 'right');
    ctx.fillText(p.label.toUpperCase(), x, y);
  });
}

async function drawShareCard(canvas, data){
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch(e) {}
  }

  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const MARGIN = 80;
  const contentW = W - MARGIN * 2;

  paintCardBackground(ctx, W, H);
  ctx.textBaseline = 'alphabetic';

  // Header: brand mark + title
  const headerCenterY = 104;
  const markSize = 88;
  const markGrad = ctx.createLinearGradient(MARGIN, headerCenterY - markSize / 2, MARGIN + markSize, headerCenterY + markSize / 2);
  markGrad.addColorStop(0, '#2F5CFF');
  markGrad.addColorStop(1, '#FF3B4E');
  roundRect(ctx, MARGIN, headerCenterY - markSize / 2, markSize, markSize, 20);
  ctx.fillStyle = markGrad;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 34px "Space Grotesk", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SA', MARGIN + markSize / 2, headerCenterY + 2);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#EDEFF7';
  ctx.font = '700 38px "Space Grotesk", sans-serif';
  ctx.fillText('Speaking Assessment', MARGIN + markSize + 24, headerCenterY - 6);
  ctx.fillStyle = 'rgba(237,239,247,0.5)';
  ctx.font = '500 22px "JetBrains Mono", monospace';
  ctx.fillText('SMALL TALK PRACTICE', MARGIN + markSize + 24, headerCenterY + 28);

  // Score section
  ctx.fillStyle = '#5B7FFF';
  ctx.font = '600 24px "JetBrains Mono", monospace';
  ctx.fillText('SCORE', MARGIN, 228);

  ctx.fillStyle = '#EDEFF7';
  ctx.font = '700 160px "Space Grotesk", sans-serif';
  const scoreText = String(data.overallScore);
  ctx.fillText(scoreText, MARGIN, 382);
  const scoreWidth = ctx.measureText(scoreText).width;
  ctx.fillStyle = 'rgba(237,239,247,0.4)';
  ctx.font = '500 48px "JetBrains Mono", monospace';
  ctx.fillText('/100', MARGIN + scoreWidth + 16, 382);

  ctx.fillStyle = '#EDEFF7';
  ctx.font = '600 44px "Space Grotesk", sans-serif';
  ctx.fillText(`${data.tierName} (${data.cefrLevel})`, MARGIN, 448);

  ctx.fillStyle = 'rgba(237,239,247,0.5)';
  ctx.font = '500 27px "JetBrains Mono", monospace';
  ctx.fillText(`IELTS BAND ${data.ieltsBand ?? '—'}`, MARGIN, 490);

  // Radar chart
  const maxR = 210;
  const radarCenterY = 780;
  drawRadarCanvas(ctx, W / 2, radarCenterY, maxR, data.radarPoints);

  // Pillar breakdown (4 rows: full label, score, note)
  let y = 1150;
  const rowH = 95;
  data.pillars.forEach(p => {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#EDEFF7';
    ctx.font = '600 27px "Space Grotesk", sans-serif';
    ctx.fillText(p.label, MARGIN, y);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 27px "Space Grotesk", sans-serif';
    ctx.fillText(`${p.score}/100`, W - MARGIN, y);

    const barY = y + 14;
    const barW = contentW;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    roundRect(ctx, MARGIN, barY, barW, 8, 4);
    ctx.fill();
    const fillGrad = ctx.createLinearGradient(MARGIN, 0, MARGIN + barW, 0);
    fillGrad.addColorStop(0, '#2F5CFF');
    fillGrad.addColorStop(1, '#FF6270');
    ctx.fillStyle = fillGrad;
    roundRect(ctx, MARGIN, barY, barW * Math.max(0, Math.min(100, p.score)) / 100, 8, 4);
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(237,239,247,0.55)';
    ctx.font = '500 22px Inter, sans-serif';
    ctx.fillText(truncateText(ctx, p.note, contentW), MARGIN, y + 54);

    y += rowH;
  });

  // Overall Feedback
  y += 20;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#5B7FFF';
  ctx.font = '600 24px "JetBrains Mono", monospace';
  ctx.fillText('OVERALL FEEDBACK', MARGIN, y);

  y += 42;
  ctx.fillStyle = '#EDEFF7';
  ctx.font = '500 26px Inter, sans-serif';
  drawWrappedText(ctx, data.summary, MARGIN, y, contentW, 36, 3);

  // Footer
  ctx.fillStyle = 'rgba(237,239,247,0.38)';
  ctx.font = '500 22px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('speaking-assessment-one.vercel.app', W / 2, H - 50);
}

async function openShareCard(data){
  shareOverlay.hidden = false;
  await drawShareCard(shareCardCanvas, data);
}

function downloadShareCard(){
  shareCardCanvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'speaking-assessment-result.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
}

shareCloseBtn.addEventListener('click', () => { shareOverlay.hidden = true; });
shareOverlay.addEventListener('click', (e) => {
  if (e.target === shareOverlay) shareOverlay.hidden = true;
});
shareDownloadBtn.addEventListener('click', downloadShareCard);
shareSendBtn.addEventListener('click', () => {
  shareCardCanvas.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], 'speaking-assessment-result.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'My Speaking Assessment Result' });
        return;
      } catch(e) {
        // user cancelled — fall through to download
      }
    }
    downloadShareCard();
  }, 'image/png');
});

// init
renderTypeList();
renderDurationOptions();
