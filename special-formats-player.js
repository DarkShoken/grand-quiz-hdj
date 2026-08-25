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

  function hint(q) {
    const type = originalType(q);
    if (q.format === 'audio') return '🎧 Écoute l’extrait sur la TV puis réponds ici.';
    if (type === 'location') return '📍 Regarde l’image sur la TV et écris le lieu demandé.';
    if (type === 'image_mystery') return '🖼️ Regarde l’image mystère sur la TV et écris ta réponse.';
    return ({
      intruder: '🕵️ Une seule proposition est l’intrus. Choisis-la.',
      truefalse: '⚖️ Choisis simplement Vrai ou Faux.',
      numeric: '🔢 Entre la valeur exacte demandée.',
      estimation: '🎯 Donne ton estimation : les réponses les plus proches marquent des points.',
      free: '✍️ Écris ta réponse puis envoie-la.',
      buzzer: '🚨 Buzze dès que tu connais la réponse.',
      progressive: '🧩 Regarde les indices apparaître sur la TV et buzze dès que tu sais.',
    })[type] || '';
  }

  function queuePatch() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(patch);
  }

  function patch() {
    queued = false;
    if (latest?.phase !== 'question' || !latest.question) return;
    const questionNode = document.querySelector('.mobile-question');
    if (!questionNode) return;
    const parent = questionNode.parentElement;
    if (!parent || parent.querySelector('.mobile-special-hint, .mobile-media-hint')) return;
    const text = hint(latest.question);
    if (!text) return;
    const node = document.createElement('div');
    node.className = 'mobile-special-hint';
    node.textContent = text;
    questionNode.insertAdjacentElement('afterend', node);
  }

  const originalCreateTransport = G.createTransport.bind(G);
  G.createTransport = function specialFormatsPlayerTransport(options = {}) {
    if (options.role !== 'player') return originalCreateTransport(options);
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
  style.textContent = '.mobile-special-hint{margin:10px 0 14px;padding:10px 12px;border-radius:13px;background:rgba(126,87,194,.14);border:1px solid rgba(179,136,255,.3);font-size:14px;font-weight:800;line-height:1.4}';
  document.head.appendChild(style);
  new MutationObserver(queuePatch).observe(document.documentElement, { childList: true, subtree: true });
})();