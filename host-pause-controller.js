(() => {
  const G = window.GrandQuiz;
  if (!G || typeof G.createTransport !== 'function') return;

  const trackedSources = [
    'host-v2.js',
    'host-all-answered.js',
    'host-game-improvements.js',
    'host-auto-launch.js',
    'host-emergency-next.js',
  ];

  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const nativeSetInterval = window.setInterval.bind(window);
  const nativeClearInterval = window.clearInterval.bind(window);

  const trackedTimers = new Map();
  let nextTimerId = -1;
  let paused = false;
  let pausedSince = 0;
  let pausedRemainingMs = null;
  let latestBaseState = null;
  let latestPublicState = null;
  let directStateSend = null;
  let currentPhase = null;
  let currentQuestionId = null;
  let questionDeadlineShift = 0;
  let revealDeadlineShift = 0;

  function clone(value) {
    try { return structuredClone(value); }
    catch {
      try { return JSON.parse(JSON.stringify(value)); }
      catch { return { ...(value || {}) }; }
    }
  }

  function isTrackedTimerCall() {
    const stack = String(new Error().stack || '');
    return trackedSources.some((source) => stack.includes(source));
  }

  function scheduleRecord(record, delay = record.remaining) {
    if (!record.active) return;
    const safeDelay = Math.max(0, Number(delay) || 0);
    record.remaining = safeDelay;
    record.dueAt = Date.now() + safeDelay;
    if (paused) {
      record.nativeId = null;
      return;
    }
    record.nativeId = nativeSetTimeout(() => {
      record.nativeId = null;
      if (!record.active) return;
      if (paused) {
        record.remaining = Math.max(0, record.dueAt - Date.now());
        return;
      }
      if (record.kind === 'timeout') {
        trackedTimers.delete(record.id);
        record.active = false;
      }
      try { record.callback(...record.args); }
      catch (error) { nativeSetTimeout(() => { throw error; }, 0); }
      if (record.kind === 'interval' && record.active) scheduleRecord(record, record.delay);
    }, safeDelay);
  }

  window.setTimeout = function pauseAwareSetTimeout(callback, delay = 0, ...args) {
    if (typeof callback !== 'function' || !isTrackedTimerCall()) {
      return nativeSetTimeout(callback, delay, ...args);
    }
    const record = {
      id: nextTimerId--,
      kind: 'timeout',
      callback,
      args,
      delay: Math.max(0, Number(delay) || 0),
      remaining: Math.max(0, Number(delay) || 0),
      dueAt: 0,
      nativeId: null,
      active: true,
    };
    trackedTimers.set(record.id, record);
    scheduleRecord(record);
    return record.id;
  };

  window.clearTimeout = function pauseAwareClearTimeout(id) {
    const record = trackedTimers.get(id);
    if (!record) return nativeClearTimeout(id);
    record.active = false;
    if (record.nativeId != null) nativeClearTimeout(record.nativeId);
    trackedTimers.delete(id);
  };

  window.setInterval = function pauseAwareSetInterval(callback, delay = 0, ...args) {
    if (typeof callback !== 'function' || !isTrackedTimerCall()) {
      return nativeSetInterval(callback, delay, ...args);
    }
    const intervalDelay = Math.max(16, Number(delay) || 0);
    const record = {
      id: nextTimerId--,
      kind: 'interval',
      callback,
      args,
      delay: intervalDelay,
      remaining: intervalDelay,
      dueAt: 0,
      nativeId: null,
      active: true,
    };
    trackedTimers.set(record.id, record);
    scheduleRecord(record);
    return record.id;
  };

  window.clearInterval = function pauseAwareClearInterval(id) {
    const record = trackedTimers.get(id);
    if (!record) return nativeClearInterval(id);
    record.active = false;
    if (record.nativeId != null) nativeClearTimeout(record.nativeId);
    trackedTimers.delete(id);
  };

  function pauseTrackedTimers() {
    const now = Date.now();
    for (const record of trackedTimers.values()) {
      if (!record.active) continue;
      if (record.nativeId != null) nativeClearTimeout(record.nativeId);
      record.nativeId = null;
      record.remaining = Math.max(0, record.dueAt - now);
    }
  }

  function resumeTrackedTimers() {
    for (const record of trackedTimers.values()) {
      if (record.active && record.nativeId == null) scheduleRecord(record, record.remaining);
    }
  }

  function playablePhase(phase) {
    return ['question', 'reveal', 'leaderboard'].includes(phase);
  }

  function observeBaseState(payload) {
    const phase = payload?.phase || null;
    const questionId = payload?.question?.id || null;

    if (questionId !== currentQuestionId) {
      currentQuestionId = questionId;
      questionDeadlineShift = 0;
      revealDeadlineShift = 0;
    }
    if (phase !== currentPhase) {
      if (phase === 'question') questionDeadlineShift = 0;
      if (phase === 'reveal') revealDeadlineShift = 0;
      currentPhase = phase;
    }

    latestBaseState = clone(payload);
  }

  function adjustedState(payload) {
    const next = clone(payload || latestBaseState || {});
    if (next.phase === 'question' && next.deadline) next.deadline = Number(next.deadline) + questionDeadlineShift;
    if (next.phase === 'reveal' && next.revealDeadline) next.revealDeadline = Number(next.revealDeadline) + revealDeadlineShift;

    if (paused) {
      next.paused = true;
      next.pausedAt = pausedSince;
      next.pausedRemainingMs = pausedRemainingMs;
      next.deadline = null;
      next.revealDeadline = null;
    } else {
      next.paused = false;
      next.pausedAt = null;
      next.pausedRemainingMs = null;
    }
    latestPublicState = clone(next);
    return next;
  }

  function effectiveRemaining(state) {
    const now = Date.now();
    if (state?.phase === 'question' && state.deadline) {
      return Math.max(0, Number(state.deadline) + questionDeadlineShift - now);
    }
    if (state?.phase === 'reveal' && state.revealDeadline) {
      return Math.max(0, Number(state.revealDeadline) + revealDeadlineShift - now);
    }
    return null;
  }

  function sendPauseState() {
    if (!directStateSend || !latestBaseState) return;
    directStateSend(adjustedState(latestBaseState));
  }

  function updateHostUi() {
    const button = document.getElementById('quizPauseButton');
    const overlay = document.getElementById('quizHostPauseOverlay');
    const phase = latestBaseState?.phase || null;
    const visible = playablePhase(phase);
    if (button) {
      button.hidden = !visible;
      button.textContent = paused ? '▶ Reprendre la partie' : '⏸ Mettre en pause';
      button.classList.toggle('green', paused);
      button.classList.toggle('danger', !paused);
      button.setAttribute('aria-pressed', paused ? 'true' : 'false');
    }
    if (overlay) overlay.hidden = !paused;
    document.body.classList.toggle('quiz-paused', paused);
  }

  function pauseGame() {
    if (paused || !playablePhase(latestBaseState?.phase)) return;
    pausedRemainingMs = effectiveRemaining(latestBaseState);
    pausedSince = Date.now();
    paused = true;
    pauseTrackedTimers();
    updateHostUi();
    sendPauseState();
  }

  function resumeGame() {
    if (!paused) return;
    const pauseDuration = Math.max(0, Date.now() - pausedSince);
    if (latestBaseState?.phase === 'question' && latestBaseState.deadline) questionDeadlineShift += pauseDuration;
    if (latestBaseState?.phase === 'reveal' && latestBaseState.revealDeadline) revealDeadlineShift += pauseDuration;
    paused = false;
    pausedSince = 0;
    pausedRemainingMs = null;
    resumeTrackedTimers();
    updateHostUi();
    sendPauseState();
  }

  function togglePause() {
    if (paused) resumeGame();
    else pauseGame();
  }

  function installUi() {
    if (!document.getElementById('quizPauseButton')) {
      const button = document.createElement('button');
      button.id = 'quizPauseButton';
      button.className = 'btn danger quiz-pause-button';
      button.type = 'button';
      button.hidden = true;
      button.addEventListener('click', togglePause);
      document.body.appendChild(button);
    }
    if (!document.getElementById('quizHostPauseOverlay')) {
      const overlay = document.createElement('div');
      overlay.id = 'quizHostPauseOverlay';
      overlay.className = 'quiz-host-pause-overlay';
      overlay.hidden = true;
      overlay.innerHTML = '<div><strong>⏸ Partie en pause</strong><span>Les chronos et les réponses sont suspendus.</span></div>';
      document.body.appendChild(overlay);
    }
    updateHostUi();
  }

  const style = document.createElement('style');
  style.textContent = `
    .quiz-pause-button{position:fixed;right:18px;bottom:18px;z-index:10020;min-width:190px;box-shadow:0 14px 36px rgba(0,0,0,.42)}
    .quiz-host-pause-overlay{position:fixed;inset:0;z-index:10010;display:grid;place-items:center;padding:24px;background:rgba(5,7,20,.72);backdrop-filter:blur(7px)}
    .quiz-host-pause-overlay[hidden]{display:none!important}
    .quiz-host-pause-overlay>div{width:min(520px,92vw);padding:28px;border-radius:24px;text-align:center;background:#12162d;border:1px solid rgba(255,255,255,.16);box-shadow:0 28px 80px rgba(0,0,0,.5)}
    .quiz-host-pause-overlay strong{display:block;font-size:clamp(1.8rem,4vw,3rem);margin-bottom:9px}
    .quiz-host-pause-overlay span{display:block;color:var(--muted);font-size:1.05rem}
    body.quiz-paused button:not(#quizPauseButton),body.quiz-paused a{pointer-events:none}
  `;
  document.head.appendChild(style);

  const originalCreateTransport = G.createTransport.bind(G);
  G.createTransport = function createTransportWithPause(options = {}) {
    const transport = originalCreateTransport(options);
    if (options.role !== 'host') return transport;

    const downstreamSend = transport.send.bind(transport);
    directStateSend = (payload) => downstreamSend('state', payload);

    transport.send = (type, payload = {}) => {
      if (type === 'state' && payload && typeof payload === 'object') {
        observeBaseState(payload);
        if (paused && !playablePhase(payload.phase)) {
          paused = false;
          pausedSince = 0;
          pausedRemainingMs = null;
          resumeTrackedTimers();
        }
        updateHostUi();
        return downstreamSend(type, adjustedState(payload));
      }
      return downstreamSend(type, payload);
    };
    return transport;
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installUi, { once: true });
  else installUi();

  window.GrandQuizPause = {
    pause: pauseGame,
    resume: resumeGame,
    toggle: togglePause,
    get paused() { return paused; },
    get state() { return clone(latestPublicState); },
  };
})();