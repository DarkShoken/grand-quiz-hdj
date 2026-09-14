(() => {
  const source = window.GRAND_QUIZ_MILLIONAIRE_AUDIO;
  if (!source) return;

  const audio = new Audio(source);
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0.24;

  let enabled = true;
  let active = false;
  let pausedByGame = false;
  let currentPhase = 'lobby';
  let startAttempted = false;

  async function playFromStart(reset = false) {
    if (!enabled) return false;
    if (reset) {
      try { audio.currentTime = 0; } catch {}
    }
    try {
      await audio.play();
      active = true;
      startAttempted = true;
      return true;
    } catch (error) {
      active = false;
      startAttempted = true;
      console.info('Lecture automatique de la musique bloquée par le navigateur.', error?.name || error);
      return false;
    }
  }

  async function start() {
    enabled = true;
    pausedByGame = false;
    return playFromStart(false);
  }

  function stop(reset = true) {
    audio.pause();
    active = false;
    if (reset) {
      try { audio.currentTime = 0; } catch {}
    }
  }

  async function toggle() {
    if (!enabled || audio.paused) {
      enabled = true;
      pausedByGame = false;
      return playFromStart(false);
    }
    enabled = false;
    stop(false);
    return false;
  }

  function setVolume(value) {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    audio.volume = Math.max(0, Math.min(1, next));
  }

  function sync(state = {}) {
    const phase = state.phase || 'lobby';
    const paused = Boolean(state.paused);
    const wasWaiting = ['lobby', 'setup', 'preview'].includes(currentPhase);
    const startsGame = phase === 'question' && wasWaiting;

    currentPhase = phase;

    if (['lobby', 'setup', 'preview', 'finished'].includes(phase)) {
      stop(true);
      pausedByGame = false;
      return;
    }

    if (paused) {
      if (!audio.paused) {
        audio.pause();
        active = false;
      }
      pausedByGame = true;
      return;
    }

    if (pausedByGame) {
      pausedByGame = false;
      if (enabled) playFromStart(false);
      return;
    }

    if (startsGame) {
      // Nouvelle partie : repartir exactement au début du thème.
      playFromStart(true);
      return;
    }

    // Si la page TV a été ouverte/rechargée en cours de partie, reprendre le fond musical.
    if (enabled && ['question', 'reveal', 'leaderboard'].includes(phase) && audio.paused && startAttempted) {
      playFromStart(false);
    }
  }

  audio.addEventListener('play', () => { active = true; });
  audio.addEventListener('pause', () => { active = false; });

  window.GrandQuizMusic = {
    start,
    stop: () => { enabled = false; stop(false); },
    toggle,
    setVolume,
    sync,
    get enabled() { return enabled && !audio.paused; },
    get available() { return true; },
    get active() { return active; },
  };
})();
