(() => {
  const G = window.GrandQuiz;
  if (!G?.createTransport) return;
  const bank = new Map((window.GRAND_QUIZ_MEDIA_LIBRARY || []).map((q) => [q.id, q]));
  let latest = null;
  let queued = false;

  function enrich(payload) {
    const source = bank.get(payload?.question?.id);
    if (source && payload.question) payload.question = { ...payload.question, format: source.format, media: source.media, clues: source.clues };
    return payload;
  }

  const originalCreateTransport = G.createTransport.bind(G);
  G.createTransport = function multimediaPlayerTransport(options = {}) {
    if (options.role !== 'player') return originalCreateTransport(options);
    const originalOnMessage = options.onMessage;
    return originalCreateTransport({
      ...options,
      onMessage(message) {
        if (message.type === 'state') {
          latest = enrich(message.payload);
          originalOnMessage?.({ ...message, payload: latest });
          queuePatch();
          return;
        }
        originalOnMessage?.(message);
      },
    });
  };

  function queuePatch() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(patch);
  }

  function patch() {
    queued = false;
    const q = latest?.question;
    const card = document.querySelector('.mobile-question');
    if (!q?.format || latest?.phase !== 'question' || !card || card.querySelector('.mobile-media-hint')) return;
    const hint = document.createElement('div');
    hint.className = 'mobile-media-hint';
    hint.textContent = q.format === 'audio'
      ? '🎧 Écoute l’extrait sur l’écran TV puis réponds ici.'
      : q.format === 'image'
        ? '🖼️ Regarde l’image mystère sur l’écran TV.'
        : '🧩 Les indices apparaissent progressivement sur l’écran TV. Buzze dès que tu sais.';
    card.querySelector('.mobile-question-text')?.after(hint);
  }

  const style = document.createElement('style');
  style.textContent = `.mobile-media-hint{margin:10px 0 12px;padding:10px 12px;border-radius:13px;background:rgba(47,107,255,.12);border:1px solid rgba(47,107,255,.25);font-size:14px;font-weight:800;line-height:1.35}`;
  document.head.appendChild(style);
  new MutationObserver(queuePatch).observe(document.documentElement, { childList: true, subtree: true });
})();
