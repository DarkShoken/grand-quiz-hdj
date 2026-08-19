(() => {
  const G = window.GrandQuiz;
  if (!G?.createTransport) return;
  let latest = null;
  let hostTransport = null;
  let queued = false;

  function mediaSource(id) {
    return (window.GRAND_QUIZ_MEDIA_LIBRARY || []).find((q) => q?.id === id) || null;
  }

  function enrichState(payload) {
    const source = mediaSource(payload?.question?.id);
    if (source && payload.question) {
      payload.question = {
        ...payload.question,
        format: source.format,
        media: source.media,
        clues: source.clues,
        originalType: source.originalType || source.type,
      };
    }
    return payload;
  }

  const originalCreateTransport = G.createTransport.bind(G);
  G.createTransport = function multimediaHostTransport(options = {}) {
    const transport = originalCreateTransport(options);
    if (options.role !== 'host') return transport;
    hostTransport = transport;
    const originalSend = transport.send.bind(transport);
    transport.send = (type, payload = {}) => {
      if (type === 'state') {
        latest = enrichState(payload);
        queuePatch();
      }
      return originalSend(type, payload);
    };
    return transport;
  };

  function formatLabel(question) {
    if (question?.originalType === 'location') return '📍 OÙ SOMMES-NOUS ?';
    return ({ audio: '🎧 QUESTION AUDIO', image: '🖼️ IMAGE MYSTÈRE', clues: '🧩 INDICES PROGRESSIFS' })[question?.format] || '';
  }

  function queuePatch() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(patch);
  }

  function patch() {
    queued = false;
    const stage = document.getElementById('hostStage');
    const q = latest?.question;
    if (!stage || !q?.format || !['question', 'reveal'].includes(latest.phase)) return;
    const label = formatLabel(q);
    if (label && !stage.querySelector('.multimedia-host-badge')) {
      const badge = document.createElement('div');
      badge.className = 'multimedia-host-badge';
      badge.textContent = label;
      stage.prepend(badge);
    }
    if (q.format === 'audio' && latest.phase === 'question' && !stage.querySelector('#hostMediaPlay')) {
      const actions = stage.querySelector('.actions');
      const button = document.createElement('button');
      button.id = 'hostMediaPlay';
      button.className = 'btn primary';
      button.type = 'button';
      button.textContent = '▶ Jouer / rejouer l’extrait';
      button.addEventListener('click', () => hostTransport?.send('media_control', { action: 'play', questionId: q.id }));
      actions?.prepend(button);
    }
    if (q.format === 'clues' && Array.isArray(q.clues) && !stage.querySelector('.host-clue-list')) {
      const block = document.createElement('div');
      block.className = 'host-clue-list';
      block.innerHTML = `<strong>Indices prévus</strong>${q.clues.map((clue, i) => `<div>${i + 1}. ${G.escapeHtml(clue)}</div>`).join('')}`;
      const key = stage.querySelector('.host-answer-key');
      key?.after(block);
    }
  }

  const style = document.createElement('style');
  style.textContent = `.multimedia-host-badge{display:inline-block;margin-bottom:10px;padding:8px 12px;border-radius:999px;background:rgba(47,107,255,.15);border:1px solid rgba(47,107,255,.35);font-weight:900;letter-spacing:.04em}.host-clue-list{margin:12px 0;padding:12px 14px;border-radius:14px;background:rgba(255,255,255,.04);line-height:1.55}.host-clue-list strong{display:block;margin-bottom:6px}`;
  document.head.appendChild(style);
  new MutationObserver(queuePatch).observe(document.documentElement, { childList: true, subtree: true });
})();
