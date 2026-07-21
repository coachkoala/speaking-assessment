import './style.css';

// ---------- Topic pool (small talk level) ----------
const TOPICS = [
  "What did you have for breakfast today?",
  "Tell me about your favorite season and why you like it.",
  "What do you usually do on weekends?",
  "Describe your favorite place to hang out with friends.",
  "What's your favorite type of music?",
  "Tell me about a movie or show you watched recently.",
  "What does your daily morning routine look like?",
  "Do you prefer coffee or tea? Tell me about it.",
  "What's the weather like where you live today?",
  "Tell me about your favorite food to cook or order.",
  "What do you like to do when you have free time?",
  "Describe your neighborhood or the area where you live.",
  "What's a small thing that made you happy this week?",
  "Tell me about a pet you have or would like to have.",
  "What's your favorite way to relax after a long day?",
  "Do you like traveling? Tell me about a place you'd like to visit.",
  "What's your favorite holiday or celebration?",
  "Tell me about a hobby you've been enjoying lately.",
  "What kind of books or articles do you like to read?",
  "Describe your ideal weekend from morning to night."
];

let currentTopic = "";
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

document.getElementById('sessionNum').textContent = 'REF-' + Math.random().toString(36).slice(2,8).toUpperCase();

// ---------- Topic selection ----------
function pickTopic(isRetry){
  if (!isRetry) {
    let t = TOPICS[Math.floor(Math.random() * TOPICS.length)];
    if (t === currentTopic && TOPICS.length > 1) {
      while (t === currentTopic) t = TOPICS[Math.floor(Math.random() * TOPICS.length)];
    }
    currentTopic = t;
  }
  questionText.classList.add('swap');
  setTimeout(() => {
    questionText.textContent = currentTopic;
    questionText.classList.remove('swap');
  }, 150);
  retryTopicBtn.disabled = false;
  resetSession();
}
newTopicBtn.addEventListener('click', () => pickTopic(false));
retryTopicBtn.addEventListener('click', () => pickTopic(true));

durationSelect.addEventListener('click', (e) => {
  const btn = e.target.closest('.dur-opt');
  if(!btn || recording || inCountdown) return;
  document.querySelectorAll('.dur-opt').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedDuration = parseInt(btn.dataset.dur, 10);
  timeLeft = selectedDuration;
  timerDisplay.textContent = timeLeft;
});

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
      body: JSON.stringify({ topic: currentTopic, transcript, fluency: fluencyMetrics })
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

function renderReport(result, transcript){
  const cats = result.categories || {};
  const catKeys = [
    { key: 'grammar_accuracy', label: 'Grammar Accuracy' },
    { key: 'vocabulary_range', label: 'Vocabulary Range' },
    { key: 'fluency_coherence', label: 'Fluency & Coherence' },
    { key: 'task_response', label: 'Task Response' }
  ];

  const catHtml = catKeys.map(c => {
    const d = cats[c.key] || { score: 0, note: '—' };
    return `
      <div class="cat">
        <div class="cat-name"><span>${c.label}</span><span class="cat-score">${d.score}/100</span></div>
        <div class="cat-bar"><div class="cat-bar-fill" data-w="${d.score}" style="width:0%"></div></div>
        <div class="cat-note">${escapeHtml(d.note)}</div>
      </div>
    `;
  }).join('');

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
      <div class="report-head">
        <div>
          <span class="cefr-badge">${escapeHtml(result.cefr_level || '?')}</span>
          <div class="cefr-sub">Estimated CEFR Level</div>
        </div>
        <div class="ielts-band">
          <div class="val">${result.ielts_band ?? '—'}</div>
          <div class="lbl">Estimated IELTS Band</div>
        </div>
      </div>

      <div class="section-title">Category Breakdown</div>
      <div class="cat-grid">${catHtml}</div>

      ${strengths ? `<div class="section-title">Strengths</div><ul class="feedback-list">${strengths}</ul>` : ''}
      ${improve ? `<div class="section-title">Areas to Improve</div><ul class="feedback-list">${improve}</ul>` : ''}
      ${corrections ? `<div class="section-title">Corrected Examples</div>${corrections}` : ''}
      ${upgrades ? `<div class="section-title">Better Ways to Say It</div>${upgrades}` : ''}

      <div class="section-title">Overall Feedback</div>
      <div class="cat-note" style="font-size:14px; line-height:1.7;">${escapeHtml(result.summary || '')}</div>

      <div class="section-title">Full Transcript</div>
      <div class="full-transcript">${escapeHtml(transcript)}</div>
    </div>
  `;

  requestAnimationFrame(() => {
    setTimeout(() => {
      document.querySelectorAll('.cat-bar-fill').forEach(bar => {
        bar.style.width = bar.dataset.w + '%';
      });
    }, 50);
  });

  reportArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function escapeHtml(str){
  if (typeof str !== 'string') return String(str ?? '');
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// init
pickTopic(false);
