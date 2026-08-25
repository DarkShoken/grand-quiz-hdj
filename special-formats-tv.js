(() => {
  const G = window.GrandQuiz;
  if (!G?.createTransport) return;
  let latest = null;
  let queued = false;

  function originalType(q) {
    if (!q) return '';
    if (q.originalType) return String(q.originalType);
    if (q.format === 'clues') return 'progressive';
    if (q.format === 'image') return 'image_mystery';
    return String(q.type || '');
  }

  function label(q) {
    return ({
      intruder: '🕵️ TROUVEZ L’INTRUS',
      truefalse: '⚖️ VRAI OU FAUX ?',
      numeric: '🔢 RÉPONSE EXACTE',
      estimation: '🎯 AU PLUS PRÈS',
      free: '✍️ RÉPONSE LIBRE',
      buzzer: '🚨 BUZZER',
      progressive: '🧩 INDICES PROGRESSIFS',
      image_mystery: '🖼️ IMAGE MYSTÈRE',
      location: '📍 OÙ SOMMES-NOUS ?',
    })[originalType(q)] || '';
  }

  function queuePatch() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(patch);
  }

  function patch() {
    queued = false;
    const q = latest?.question;
    if (!q || !['question', 'reveal'].includes(latest?.phase)) return;
    const card = document.querySelector('#stage .question-card');
    if (!card) return;

    const type = originalType(q);
    if (!card.querySelector('.special-format-tv')) {
      const text = label(q);
      if (text && type !== 'mcq') {
        const node = document.createElement('div');
        node.className = 'special-format-tv';
        node.textContent = text;
        const questionText = card.querySelector('.question-text');
        questionText?.before(node);
      }
    }

    if (latest.phase !== 'question') return;

    // tv-v8 traite historiquement tout ce qui n'est ni QCM ni numérique comme un buzzer.
    // Les réponses libres doivent au contraire laisser le temps d'écrire sur le téléphone.
    if (q.type === 'free') {
      const buzzer = card.querySelector('.buzzer-instruction');
      if (buzzer) {
        buzzer.className = 'free-answer-instruction';
        buzzer.textContent = q.format === 'image'
          ? '✍️ Regardez l’image puis écrivez votre réponse sur votre téléphone'
          : '✍️ Écrivez votre réponse sur votre téléphone';
      }
      const status = card.querySelector('.buzzer-status');
      if (status) {
        status.className = 'explanation free-answer-status';
        status.textContent = 'Vous pouvez corriger votre réponse tant que le temps n’est pas écoulé.';
      }
    }

    if (q.type === 'numeric') {
      const instruction = card.querySelector('.numeric-instruction');
      if (instruction) {
        instruction.textContent = type === 'estimation'
          ? '🎯 Donnez votre estimation sur votre téléphone — les plus proches marquent des points'
          : '🔢 Entrez la valeur exacte sur votre téléphone';
      }
    }
  }

  const originalCreateTransport = G.createTransport.bind(G);
  G.createTransport = function specialFormatsScreenTransport(options = {}) {
    if (options.role !== 'screen') return originalCreateTransport(options);
    const originalOnMessage = options.onMessage;
    return originalCreateTransport({
      ...options,
      onMessage(message) {
        if (message.type === 'state') {
          latest = message.payload;
          originalOnMessage?.(message);
          queuePatch();
          return;
        }
        originalOnMessage?.(message);
      },
    });
  };

  const style = document.createElement('style');
  style.textContent = `
    .special-format-tv{margin:0 auto 12px;width:max-content;max-width:100%;padding:8px 15px;border-radius:999px;background:rgba(126,87,194,.17);border:1px solid rgba(179,136,255,.42);font-size:clamp(15px,1.45vw,22px);font-weight:1000;letter-spacing:.08em;text-align:center}
    .free-answer-instruction{margin:22px auto 8px;max-width:900px;padding:18px 24px;border-radius:22px;background:rgba(72,219,251,.11);border:1px solid rgba(72,219,251,.28);font-size:clamp(20px,2vw,30px);font-weight:900;text-align:center}
    .free-answer-status{text-align:center;opacity:.8}
  `;
  document.head.appendChild(style);
  new MutationObserver(queuePatch).observe(document.documentElement, { childList: true, subtree: true });
})();