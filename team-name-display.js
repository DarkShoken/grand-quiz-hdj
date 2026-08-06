(() => {
  const G = window.GrandQuiz;
  if (!G || typeof G.createTransport !== 'function') return;

  let teamNames = { Orange: 'Équipe Orange', Bleue: 'Équipe Bleue' };
  let renderQueued = false;

  function cleanNames(value) {
    if (!value || typeof value !== 'object') return;
    const orange = String(value.Orange || '').trim();
    const blue = String(value.Bleue || '').trim();
    if (orange) teamNames.Orange = orange;
    if (blue) teamNames.Bleue = blue;
  }

  function replaceText(text) {
    return String(text)
      .replace(/Équipe Orange/g, teamNames.Orange)
      .replace(/Équipe Bleue/g, teamNames.Bleue)
      .replace(/Equipe Orange/g, teamNames.Orange)
      .replace(/Equipe Bleue/g, teamNames.Bleue);
  }

  function patchDom() {
    renderQueued = false;

    const orangeButtons = ['teamOrange', 'waitTeamOrange'];
    const blueButtons = ['teamBlue', 'waitTeamBlue'];
    for (const id of orangeButtons) {
      const button = document.getElementById(id);
      if (button && button.textContent !== `🟠 ${teamNames.Orange}`) button.textContent = `🟠 ${teamNames.Orange}`;
    }
    for (const id of blueButtons) {
      const button = document.getElementById(id);
      if (button && button.textContent !== `🔵 ${teamNames.Bleue}`) button.textContent = `🔵 ${teamNames.Bleue}`;
    }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest('script,style,textarea,input')) return NodeFilter.FILTER_REJECT;
        return /Équipe (Orange|Bleue)|Equipe (Orange|Bleue)/.test(node.nodeValue || '')
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const next = replaceText(node.nodeValue || '');
      if (next !== node.nodeValue) node.nodeValue = next;
    }
  }

  function schedulePatch() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(patchDom);
  }

  const originalCreateTransport = G.createTransport.bind(G);
  G.createTransport = function createTransportWithTeamNames(options = {}) {
    const originalOnMessage = options.onMessage;
    const transport = originalCreateTransport({
      ...options,
      onMessage(message) {
        if (message?.type === 'state') {
          cleanNames(message.payload?.teamNames);
          schedulePatch();
        }
        originalOnMessage?.(message);
      },
    });

    const originalSend = transport.send.bind(transport);
    transport.send = (type, payload = {}) => {
      if (type === 'state') {
        cleanNames(payload?.teamNames);
        schedulePatch();
      }
      return originalSend(type, payload);
    };

    return transport;
  };

  const observer = new MutationObserver(schedulePatch);
  const start = () => {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    schedulePatch();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
