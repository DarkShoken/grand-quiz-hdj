(() => {
  const G = window.GrandQuiz;
  if (!G || typeof G.createTransport !== 'function') return;

  const REVEAL_DURATION_MS = 10000;
  const STORAGE_PREFIX = 'grand-quiz-team-names:';
  const nouns = [
    'Patates', 'Flamants', 'Pingouins', 'Licornes', 'Castors', 'Loutres', 'Cactus',
    'Poulpes', 'Marmottes', 'Bananes', 'Chaussettes', 'Croissants', 'Hérissons',
    'Axolotls', 'Tortues', 'Pandas', 'Sardines', 'Courgettes', 'Moustiques', 'Alpagas',
  ];
  const adjectives = [
    'Cosmiques', 'Déchaînés', 'Moustachus', 'Électriques', 'Farceurs', 'Intrépides',
    'Galactiques', 'Pressés', 'Survoltés', 'Mystiques', 'Acrobates', 'Légendaires',
    'Pailletés', 'Turbulents', 'Royaux', 'Explosifs', 'Malicieux', 'Supersoniques',
  ];

  let room = G.cleanRoom(G.qs('room', 'QUIZ'));
  let teamNames = loadNames();
  let previousPhase = null;
  let activeQuestionId = null;
  let revealQuestionId = null;
  let revealAt = 0;
  let revealTimer = null;
  let revealClock = null;
  let savedAnswerLog = '';
  let savedAnswerQuestionId = null;
  let latestPhase = null;
  let latestMode = 'individual';
  let patchQueued = false;

  function storageKey() {
    return `${STORAGE_PREFIX}${room}`;
  }

  function loadNames() {
    try {
      const parsed = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${room}`) || 'null');
      if (parsed?.Orange && parsed?.Bleue) return parsed;
    } catch {}
    return null;
  }

  function randomItem(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function generateName() {
    return `Les ${randomItem(nouns)} ${randomItem(adjectives)}`;
  }

  function generateNames() {
    let orange = generateName();
    let blue = generateName();
    while (blue === orange) blue = generateName();
    teamNames = { Orange: orange, Bleue: blue };
    localStorage.setItem(storageKey(), JSON.stringify(teamNames));
  }

  function clearRevealTimers() {
    clearTimeout(revealTimer);
    clearInterval(revealClock);
    revealTimer = null;
    revealClock = null;
    revealAt = 0;
    revealQuestionId = null;
  }

  function clickNextWhenReady(attempt = 0) {
    if (latestPhase !== 'reveal') return;
    const button = document.getElementById('nextBtn');
    if (button) {
      button.click();
      return;
    }
    if (attempt < 10) setTimeout(() => clickNextWhenReady(attempt + 1), 100);
  }

  function startFastReveal(questionId) {
    if (revealQuestionId === questionId && revealTimer) return;
    clearRevealTimers();
    revealQuestionId = questionId;
    revealAt = Date.now() + REVEAL_DURATION_MS;
    revealTimer = setTimeout(clickNextWhenReady, REVEAL_DURATION_MS + 40);
    revealClock = setInterval(() => {
      if (latestPhase !== 'reveal') {
        clearRevealTimers();
        return;
      }
      const node = document.getElementById('hostRevealTimer');
      if (node) {
        const seconds = Math.max(0, Math.ceil((revealAt - Date.now()) / 1000));
        const text = String(seconds);
        if (node.textContent !== text) node.textContent = text;
      }
    }, 60);
  }

  function schedulePatch() {
    if (patchQueued) return;
    patchQueued = true;
    requestAnimationFrame(patchDom);
  }

  function patchDom() {
    patchQueued = false;
    const stage = document.getElementById('hostStage');
    if (!stage) return;

    if (latestPhase === 'question') {
      const log = stage.querySelector('.answer-log');
      if (log && activeQuestionId) {
        savedAnswerLog = log.innerHTML;
        savedAnswerQuestionId = activeQuestionId;
      }
    }

    if (latestPhase === 'reveal') {
      const label = stage.querySelector('.host-auto-next span');
      if (label && label.textContent !== '10 secondes pour commenter la réponse.') {
        label.textContent = '10 secondes pour commenter la réponse.';
      }

      if (savedAnswerLog && savedAnswerQuestionId === activeQuestionId && !stage.querySelector('.preserved-answer-log')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'preserved-answer-block';
        wrapper.innerHTML = `<div class="answer-log-title">Réponses des participants</div><div class="answer-log preserved-answer-log">${savedAnswerLog}</div>`;
        const autoNext = stage.querySelector('.host-auto-next');
        stage.insertBefore(wrapper, autoNext || null);
      }
    }

    if (latestMode === 'teams' && teamNames && ['preview', 'question', 'reveal', 'leaderboard'].includes(latestPhase)) {
      let summary = stage.querySelector('.generated-team-names');
      if (!summary) {
        summary = document.createElement('div');
        summary.className = 'generated-team-names';
        stage.prepend(summary);
      }
      const text = `🟠 ${teamNames.Orange}  ·  🔵 ${teamNames.Bleue}`;
      if (summary.textContent !== text) summary.textContent = text;
    }
  }

  const style = document.createElement('style');
  style.textContent = `
    .generated-team-names{margin:0 0 12px;padding:10px 13px;border-radius:14px;background:rgba(155,93,229,.12);border:1px solid rgba(155,93,229,.28);font-weight:900;text-align:center}
    .preserved-answer-block{margin:16px 0;padding:12px;border-radius:16px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08)}
    .preserved-answer-block .answer-log-title{margin-top:0}
    .preserved-answer-log{max-height:260px;overflow:auto}
  `;
  document.head.appendChild(style);

  const originalCreateTransport = G.createTransport.bind(G);
  G.createTransport = function createTransportWithGameImprovements(options = {}) {
    const transport = originalCreateTransport(options);
    if (options.role !== 'host') return transport;

    const originalSend = transport.send.bind(transport);
    transport.send = (type, payload = {}) => {
      if (type === 'state' && payload && typeof payload === 'object') {
        room = G.cleanRoom(payload.room || room);
        latestPhase = payload.phase || null;
        latestMode = payload.mode || 'individual';
        const questionId = payload.question?.id || null;

        if (payload.phase === 'preview' && previousPhase !== 'preview') generateNames();
        if (payload.mode === 'teams' && !teamNames) generateNames();
        if (teamNames) payload.teamNames = { ...teamNames };

        if (questionId !== activeQuestionId) {
          activeQuestionId = questionId;
          savedAnswerLog = '';
          savedAnswerQuestionId = null;
        }

        if (payload.phase === 'reveal') {
          if (revealQuestionId !== questionId || !revealAt) startFastReveal(questionId);
          payload.revealDeadline = revealAt;
        } else if (previousPhase === 'reveal') {
          clearRevealTimers();
        }

        previousPhase = payload.phase || null;
        schedulePatch();
      }
      return originalSend(type, payload);
    };

    return transport;
  };

  const observer = new MutationObserver(schedulePatch);
  const start = () => observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  window.addEventListener('pagehide', clearRevealTimers);
})();
