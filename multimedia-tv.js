(() => {
  const G = window.GrandQuiz;
  if (!G?.createTransport) return;
  const bank = new Map((window.GRAND_QUIZ_MEDIA_LIBRARY || []).map((q) => [q.id, q]));
  let latest = null;
  let currentQuestionId = null;
  let clueTimers = [];
  let audioCtx = null;
  let mediaAudio = null;
  let patchQueued = false;

  function enrich(payload) {
    const source = bank.get(payload?.question?.id);
    if (source && payload.question) payload.question = { ...payload.question, format: source.format, media: source.media, clues: source.clues, originalType: source.originalType || source.type };
    return payload;
  }

  function clearClues() { clueTimers.forEach(clearTimeout); clueTimers = []; }
  function stopMedia() { if (mediaAudio) { mediaAudio.pause(); mediaAudio.currentTime = 0; mediaAudio = null; } }

  const originalCreateTransport = G.createTransport.bind(G);
  G.createTransport = function multimediaScreenTransport(options = {}) {
    if (options.role !== 'screen') return originalCreateTransport(options);
    const originalOnMessage = options.onMessage;
    return originalCreateTransport({
      ...options,
      onMessage(message) {
        if (message.type === 'state') {
          latest = enrich(message.payload);
          const nextId = latest?.question?.id || null;
          if (nextId !== currentQuestionId) { currentQuestionId = nextId; clearClues(); stopMedia(); }
          originalOnMessage?.({ ...message, payload: latest });
          queuePatch();
          return;
        }
        if (message.type === 'media_control' && message.payload?.action === 'play' && message.payload?.questionId === latest?.question?.id) playCurrentMedia();
        originalOnMessage?.(message);
      },
    });
  };

  function ensureAudioContext() {
    if (audioCtx && audioCtx.state !== 'closed') return audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx(); return audioCtx;
  }
  function midiToHz(note) { return 440 * Math.pow(2, (note - 69) / 12); }
  function tone(note, at, duration, gainValue = 0.12) {
    const ctx = ensureAudioContext(); if (!ctx) return;
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'triangle'; osc.frequency.setValueAtTime(midiToHz(note), at);
    gain.gain.setValueAtTime(0.0001, at); gain.gain.exponentialRampToValueAtTime(gainValue, at + 0.015); gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain); gain.connect(ctx.destination); osc.start(at); osc.stop(at + duration + 0.04);
  }

  async function playSynth(name) {
    const ctx = ensureAudioContext(); if (!ctx) return;
    try { if (ctx.state !== 'running') await ctx.resume(); } catch {}
    const start = ctx.currentTime + 0.05; let sequence = []; let beat = 0.34;
    if (name === 'beethoven5') { sequence = [[67,.22],[67,.22],[67,.22],[63,.72],[65,.22],[65,.22],[65,.22],[62,.72]]; beat = 0.28; }
    if (name === 'frere-jacques') { sequence = [60,62,64,60,60,62,64,60,64,65,67,null,64,65,67].map(n => [n,n == null ? .22 : .3]); beat = 0.33; }
    if (name === 'au-clair-de-la-lune') { sequence = [60,60,60,62,64,62,60,64,62,62,60].map(n => [n,.31]); beat = 0.34; }
    if (name === 'morse-sos') {
      let t = start; const dot=.11, dash=.33, gap=.09, letter=.28;
      for (const symbol of ['...','---','...']) { for (const char of symbol) { tone(81, t, char === '.' ? dot : dash, .1); t += (char === '.' ? dot : dash) + gap; } t += letter; }
      return;
    }
    let t = start; for (const [note, duration] of sequence) { if (note != null) tone(note, t, duration || beat * .8, .1); t += beat; }
  }

  async function playCurrentMedia() {
    const media = latest?.question?.media; if (!media || latest?.paused) return;
    window.GrandQuizMusic?.setVolume?.(0.025);
    if (media.kind === 'synth') { await playSynth(media.synth); setTimeout(() => window.GrandQuizMusic?.setVolume?.(0.145), Math.max(2500, (Number(media.duration) || 5) * 1000)); return; }
    if (media.kind === 'audio' && media.src) {
      stopMedia(); mediaAudio = new Audio(media.src); mediaAudio.preload = 'auto';
      mediaAudio.addEventListener('ended', () => window.GrandQuizMusic?.setVolume?.(0.145), { once: true });
      try { await mediaAudio.play(); } catch { window.GrandQuizMusic?.setVolume?.(0.145); }
    }
  }

  function queuePatch() { if (patchQueued) return; patchQueued = true; requestAnimationFrame(patch); }
  function patch() {
    patchQueued = false;
    const q = latest?.question; const stage = document.getElementById('stage');
    if (!stage || latest?.phase !== 'question' || !q?.format) return;
    const card = stage.querySelector('.question-card'); if (!card) return;

    if (q.format === 'audio' && !card.querySelector('.media-audio-card')) {
      const node = document.createElement('div'); node.className = 'media-audio-card';
      node.innerHTML = `<div class="media-format-title">🎧 ÉCOUTEZ BIEN</div><div class="media-equalizer"><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="media-caption">${G.escapeHtml(q.media?.label || 'Extrait audio')}</div><button id="tvMediaPlay" class="btn primary" type="button">▶ Écouter l’extrait</button>`;
      card.querySelector('.question-text')?.after(node); node.querySelector('#tvMediaPlay')?.addEventListener('click', playCurrentMedia);
    }

    if (q.format === 'image' && q.media?.src && !card.querySelector('.media-image-card')) {
      const node = document.createElement('div'); node.className = 'media-image-card';
      const title = q.originalType === 'location' ? '📍 OÙ SOMMES-NOUS ?' : '🖼️ IMAGE MYSTÈRE';
      node.innerHTML = `<div class="media-format-title">${title}</div><img alt="${G.escapeHtml(q.media.label || 'Image mystère')}" src="${q.media.src}">`;
      card.querySelector('.question-text')?.after(node); requestAnimationFrame(() => node.classList.add('revealing'));
    }

    if (q.format === 'clues' && Array.isArray(q.clues) && !card.querySelector('.media-clues-card')) {
      clearClues(); const node = document.createElement('div'); node.className = 'media-clues-card';
      node.innerHTML = `<div class="media-format-title">🧩 INDICES PROGRESSIFS</div><div class="media-clues-list"></div>`;
      card.querySelector('.question-text')?.after(node); const list = node.querySelector('.media-clues-list');
      const reveal = (index) => {
        if (latest?.paused || latest?.phase !== 'question' || latest?.question?.id !== q.id || latest?.buzzedPlayerId) return;
        const clue = document.createElement('div'); clue.className = 'media-clue'; clue.innerHTML = `<span>${index + 1}</span>${G.escapeHtml(q.clues[index])}`; list.appendChild(clue);
      };
      reveal(0); q.clues.slice(1).forEach((_, index) => clueTimers.push(setTimeout(() => reveal(index + 1), (index + 1) * 4500)));
    }
  }

  const style = document.createElement('style');
  style.textContent = `
    .media-format-title{font-weight:1000;letter-spacing:.12em;font-size:clamp(16px,1.7vw,25px);margin-bottom:10px}
    .media-audio-card,.media-image-card,.media-clues-card{margin:16px auto 18px;padding:18px 22px;border-radius:24px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.12);text-align:center;max-width:920px}
    .media-equalizer{height:78px;display:flex;align-items:center;justify-content:center;gap:10px;margin:8px 0 12px}.media-equalizer i{display:block;width:13px;height:32px;border-radius:8px;background:currentColor;animation:eq 1s ease-in-out infinite alternate}.media-equalizer i:nth-child(2){animation-delay:-.25s}.media-equalizer i:nth-child(3){animation-delay:-.55s}.media-equalizer i:nth-child(4){animation-delay:-.35s}.media-equalizer i:nth-child(5){animation-delay:-.75s}.media-equalizer i:nth-child(6){animation-delay:-.12s}@keyframes eq{from{height:18px;opacity:.45}to{height:72px;opacity:1}}
    .media-caption{font-size:18px;opacity:.75;margin-bottom:12px}.media-image-card img{display:block;margin:auto;max-width:min(620px,72vw);max-height:300px;border-radius:20px;filter:blur(24px);transform:scale(1.06);transition:filter 8s linear,transform 8s linear}.media-image-card.revealing img{filter:blur(0);transform:scale(1)}
    .media-clues-list{display:grid;gap:9px;text-align:left}.media-clue{display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:14px;background:rgba(255,255,255,.07);font-size:clamp(17px,1.65vw,24px);animation:clueIn .28s ease-out}.media-clue span{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:rgba(47,107,255,.25);font-weight:900}@keyframes clueIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  `;
  document.head.appendChild(style);
  new MutationObserver(queuePatch).observe(document.documentElement, { childList: true, subtree: true });
})();
