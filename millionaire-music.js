(() => {
  const source = '/api/millionaire-music?v=1';
  const audio = new Audio(source);
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0.24;

  let enabled = true;
  let active = false;
  let pausedByGame = false;
  let currentPhase = 'lobby';
  let startAttempted = false;
  let userActivated = false;
  let lastError = null;

  async function playFromStart(reset = false) {
    if (!enabled) return false;
    if (reset) {
      try { audio.currentTime = 0; } catch {}
    }
    try {
      await audio.play();
      active = true;
      startAttempted = true;
      lastError = null;
      return true;
    } catch (error) {
      active = false;
      startAttempted = true;
      lastError = error;
      console.error('Lecture de la musique impossible', error);
      return false;
    }
  }

  async function start() {
    enabled = true;
    userActivated = true;
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
      userActivated = true;
      pausedByGame = false;
      return playFromStart(false);
    }
    enabled = false;
    userActivated = false;
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

    if (phase === 'finished') {
      stop(true);
      pausedByGame = false;
      return;
    }

    // Un clic manuel dans le lobby sert aussi de test son et débloque l'autoplay.
    // On laisse donc la musique audible jusqu'au démarrage de la partie.
    if (['lobby', 'setup', 'preview'].includes(phase)) {
      if (!userActivated) stop(true);
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
      if (enabled) playFromStart(true);
      return;
    }

    if (enabled && ['question', 'reveal', 'leaderboard'].includes(phase) && audio.paused && startAttempted) {
      playFromStart(false);
    }
  }

  audio.addEventListener('play', () => { active = true; lastError = null; });
  audio.addEventListener('pause', () => { active = false; });
  audio.addEventListener('error', () => {
    active = false;
    lastError = audio.error || new Error('Erreur audio inconnue');
    console.error('Erreur de chargement du MP3', audio.error);
  });

  window.GrandQuizMusic = {
    start,
    stop: () => { enabled = false; userActivated = false; stop(false); },
    toggle,
    setVolume,
    sync,
    get enabled() { return enabled && !audio.paused; },
    get available() { return true; },
    get active() { return active; },
    get lastError() { return lastError; },
    get source() { return source; },
  };
})();
