(() => {
  let ctx = null;
  let master = null;
  let compressor = null;
  let noiseBuffer = null;
  let scheduler = null;
  let enabled = false;
  let volume = 0.135;
  let step = 0;
  let section = 0;
  let variation = 0;
  let themeIndex = -1;
  let recentThemes = [];
  let lastQuestionId = null;
  let lastPhase = 'lobby';
  let timeUpPlayedFor = null;
  let state = { phase: 'lobby', durationMs: 20000, deadline: null, questionId: null, paused: false };

  const themes = [
    {
      roots: [60, 65, 67, 62], qualities: ['major', 'major', 'major', 'minor'],
      scale: [0, 2, 4, 7, 9, 12, 14], lead: [4, 7, 9, 7, 4, 2, 4, 7, 9, 12, 9, 7, 4, 2, 0, 2],
      leadWave: 'triangle', bassWave: 'sine', tempo: 96, cutoff: 2350,
    },
    {
      roots: [57, 60, 65, 62], qualities: ['minor', 'major', 'major', 'minor'],
      scale: [0, 3, 5, 7, 10, 12, 15], lead: [7, 10, 12, 10, 7, 5, 3, 5, 7, 10, 7, 5, 3, 0, 3, 5],
      leadWave: 'sine', bassWave: 'triangle', tempo: 102, cutoff: 2050,
    },
    {
      roots: [62, 67, 64, 69], qualities: ['minor', 'major', 'minor', 'minor'],
      scale: [0, 2, 3, 5, 7, 10, 12], lead: [3, 5, 7, 10, 7, 5, 3, 2, 3, 7, 10, 12, 10, 7, 5, 3],
      leadWave: 'triangle', bassWave: 'sine', tempo: 100, cutoff: 2500,
    },
    {
      roots: [65, 60, 62, 67], qualities: ['major', 'major', 'minor', 'major'],
      scale: [0, 2, 4, 5, 7, 9, 12], lead: [9, 7, 5, 4, 2, 4, 5, 7, 9, 12, 9, 7, 5, 4, 2, 0],
      leadWave: 'sine', bassWave: 'triangle', tempo: 92, cutoff: 2200,
    },
    {
      roots: [59, 64, 62, 67], qualities: ['minor', 'minor', 'minor', 'major'],
      scale: [0, 2, 3, 7, 9, 10, 12], lead: [0, 3, 7, 9, 7, 3, 2, 3, 7, 10, 12, 10, 7, 3, 2, 0],
      leadWave: 'triangle', bassWave: 'sine', tempo: 106, cutoff: 2450,
    },
    {
      roots: [60, 62, 65, 67], qualities: ['major', 'minor', 'major', 'major'],
      scale: [0, 2, 4, 7, 9, 11, 12], lead: [7, 9, 11, 12, 9, 7, 4, 7, 9, 11, 14, 12, 11, 9, 7, 4],
      leadWave: 'sine', bassWave: 'triangle', tempo: 98, cutoff: 2300,
    },
  ];

  const rhythmPatterns = [
    [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1],
    [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1],
    [1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0],
  ];

  function midiToHz(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  function hashString(value) {
    let hash = 2166136261;
    for (const char of String(value || '')) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0);
  }

  function currentTheme() {
    return themes[Math.max(0, themeIndex)] || themes[0];
  }

  function chooseTheme(seed = Date.now()) {
    const available = themes.map((_, index) => index).filter((index) => !recentThemes.includes(index));
    const pool = available.length ? available : themes.map((_, index) => index);
    themeIndex = pool[hashString(seed) % pool.length];
    recentThemes.push(themeIndex);
    recentThemes = recentThemes.slice(-2);
    variation = hashString(`${seed}:variation`) % rhythmPatterns.length;
    section = 0;
  }

  function ensureAudio() {
    if (ctx && ctx.state !== 'closed') return true;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;

    ctx = new AudioContextClass();
    master = ctx.createGain();
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -23;
    compressor.knee.value = 20;
    compressor.ratio.value = 3.2;
    compressor.attack.value = 0.012;
    compressor.release.value = 0.24;
    master.gain.value = volume;
    master.connect(compressor);
    compressor.connect(ctx.destination);

    noiseBuffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * 0.12)), ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    chooseTheme('lobby-start');
    return true;
  }

  function playTone(note, duration = 0.14, type = 'triangle', gainValue = 0.05, delay = 0, cutoff = 2200, detune = 0) {
    if (!ctx || !master || note == null || ctx.state === 'closed') return;
    const when = ctx.currentTime + Math.max(0, delay);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = type;
    osc.frequency.setValueAtTime(midiToHz(note), when);
    osc.detune.setValueAtTime(detune, when);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, when);
    filter.Q.value = 0.55;

    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(0.05, duration));

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + duration + 0.06);
  }

  function chordIntervals(quality) {
    return quality === 'minor' ? [0, 3, 7] : [0, 4, 7];
  }

  function playChord(root, quality, duration = 0.34, gainValue = 0.022, delay = 0) {
    chordIntervals(quality).forEach((interval, index) => {
      playTone(root + interval, duration, 'sine', gainValue, delay + index * 0.014, 1850, index === 1 ? -3 : 0);
    });
  }

  function playKick(gainValue = 0.045, delay = 0) {
    if (!ctx || !master) return;
    const when = ctx.currentTime + Math.max(0, delay);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(115, when);
    osc.frequency.exponentialRampToValueAtTime(43, when + 0.11);
    gain.gain.setValueAtTime(Math.max(0.0002, gainValue), when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.13);
    osc.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + 0.15);
  }

  function playHat(gainValue = 0.012, delay = 0) {
    if (!ctx || !master || !noiseBuffer) return;
    const when = ctx.currentTime + Math.max(0, delay);
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = noiseBuffer;
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(5200, when);
    gain.gain.setValueAtTime(Math.max(0.0002, gainValue), when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(when);
    source.stop(when + 0.055);
  }

  function countdownInfo() {
    if (state.phase !== 'question' || !state.deadline || state.paused) return null;
    const duration = Math.max(1000, Number(state.durationMs) || 20000);
    const remaining = Math.max(0, Number(state.deadline) - Date.now());
    const progress = Math.max(0, Math.min(1, 1 - remaining / duration));
    return { duration, remaining, progress };
  }

  function tempoForState() {
    const theme = currentTheme();
    const info = countdownInfo();
    if (!info) return state.phase === 'lobby' ? theme.tempo - 8 : theme.tempo - 12;
    if (info.remaining <= 2000 || info.progress >= 0.95) return 164;
    if (info.remaining <= 5000 || info.progress >= 0.82) return 146;
    if (info.progress >= 0.62) return theme.tempo + 24;
    if (info.progress >= 0.35) return theme.tempo + 12;
    return theme.tempo;
  }

  function stepDelayMs() {
    return (60000 / tempoForState()) / 2;
  }

  function rootForStep(theme, currentStep = step) {
    const index = (Math.floor(currentStep / 8) + section) % theme.roots.length;
    return { root: theme.roots[index], quality: theme.qualities[index] || 'major' };
  }

  function melodicNote(theme, currentStep = step, intensity = 0) {
    const offset = (currentStep + variation * 3 + section * 2) % theme.lead.length;
    let interval = theme.lead[offset];
    if (intensity >= 2 && currentStep % 4 === 2) interval += 12;
    if (variation === 3 && currentStep % 8 === 6) interval -= 5;
    return interval;
  }

  function playLobbyStep() {
    const theme = currentTheme();
    const i = step % 16;
    const { root, quality } = rootForStep(theme);
    const rhythm = rhythmPatterns[variation];

    if (step > 0 && step % 64 === 0) chooseTheme(`lobby-${step}-${Date.now()}`);
    if (i === 0 || i === 8) playChord(root, quality, 0.48, 0.021, 0.01);
    if (i % 4 === 0) playTone(root - 12, 0.2, theme.bassWave, 0.052, 0, 1350);
    if (rhythm[i] && (i % 2 === 0 || variation >= 2)) {
      playTone(root + melodicNote(theme, step), 0.16, theme.leadWave, 0.029, 0.018, theme.cutoff);
    }
    if (i === 4 || i === 12) playHat(0.008);
  }

  function playQuestionStep() {
    const info = countdownInfo();
    if (!info) return;
    if (info.remaining <= 0) {
      if (timeUpPlayedFor !== state.deadline) {
        timeUpPlayedFor = state.deadline;
        playTimeUp();
      }
      return;
    }

    const theme = currentTheme();
    const i = step % 16;
    const { root, quality } = rootForStep(theme);
    const finalFive = info.remaining <= 5000;
    const intensity = finalFive || info.progress >= 0.82 ? 3 : info.progress >= 0.62 ? 2 : info.progress >= 0.32 ? 1 : 0;
    const rhythm = rhythmPatterns[(variation + intensity) % rhythmPatterns.length];

    if (i % 4 === 0) playKick(intensity >= 2 ? 0.052 : 0.039);
    if (intensity >= 2 && i % 2 === 1) playHat(intensity >= 3 ? 0.014 : 0.01);
    else if (intensity < 2 && (i === 6 || i === 14)) playHat(0.007);

    if (i % 2 === 0) {
      playTone(root - 12, intensity >= 2 ? 0.105 : 0.17, theme.bassWave, intensity >= 2 ? 0.064 : 0.054, 0, 1350);
    }
    if (i === 0 || i === 8 || (intensity >= 2 && i === 4)) {
      playChord(root, quality, intensity >= 2 ? 0.22 : 0.34, intensity >= 2 ? 0.027 : 0.022, 0.01);
    }
    if (rhythm[i]) {
      const duration = intensity >= 3 ? 0.075 : intensity >= 2 ? 0.105 : 0.145;
      const gain = intensity >= 3 ? 0.029 : intensity >= 2 ? 0.033 : 0.029;
      playTone(root + melodicNote(theme, step, intensity), duration, theme.leadWave, gain, 0.016, intensity >= 3 ? 2100 : theme.cutoff);
    }

    if (step > 0 && step % 32 === 0) section = (section + 1) % theme.roots.length;
  }

  function playNeutralStep() {
    const theme = currentTheme();
    const i = step % 16;
    const { root, quality } = rootForStep(theme);
    if (i === 0 || i === 8) playChord(root, quality, 0.42, 0.018, 0.01);
    if (i % 4 === 0) playTone(root - 12, 0.18, theme.bassWave, 0.043, 0, 1300);
    if (i === 6 || i === 14) playTone(root + theme.scale[(variation + i / 2) % theme.scale.length], 0.14, theme.leadWave, 0.022, 0.01, theme.cutoff);
  }

  function playQuestionStart() {
    if (!enabled || !ctx) return;
    const theme = currentTheme();
    const root = theme.roots[0];
    playTone(root + 7, 0.1, theme.leadWave, 0.048, 0, theme.cutoff);
    playTone(root + 12, 0.1, theme.leadWave, 0.052, 0.075, theme.cutoff);
    playTone(root + 16, 0.19, theme.leadWave, 0.058, 0.15, theme.cutoff);
  }

  function playReveal() {
    if (!enabled || !ctx || state.paused) return;
    const theme = currentTheme();
    const root = theme.roots[(section + 1) % theme.roots.length];
    const notes = variation % 2 === 0 ? [0, 4, 7, 12] : [0, 7, 9, 12];
    notes.forEach((interval, index) => playTone(root + interval, index === notes.length - 1 ? 0.28 : 0.11, theme.leadWave, 0.046 + index * 0.004, index * 0.075, theme.cutoff));
  }

  function playTimeUp() {
    if (!enabled || !ctx || state.paused) return;
    const theme = currentTheme();
    const root = theme.roots[0];
    playTone(root + 12, 0.1, theme.leadWave, 0.048, 0, 1800);
    playTone(root + 7, 0.11, theme.leadWave, 0.052, 0.1, 1650);
    playTone(root, 0.27, theme.bassWave, 0.065, 0.21, 1400);
  }

  function schedule() {
    if (!enabled) return;
    if (state.paused) {
      scheduler = window.setTimeout(schedule, 220);
      return;
    }
    if (state.phase === 'question') playQuestionStep();
    else if (state.phase === 'lobby') playLobbyStep();
    else playNeutralStep();
    step += 1;
    scheduler = window.setTimeout(schedule, stepDelayMs());
  }

  function restartScheduler() {
    if (scheduler) {
      clearTimeout(scheduler);
      scheduler = null;
    }
    if (enabled) schedule();
  }

  function sync(nextState = {}) {
    const nextPhase = nextState.phase || 'lobby';
    const nextQuestionId = nextState.question?.id || nextState.questionId || null;
    const phaseChanged = nextPhase !== lastPhase;
    const questionChanged = Boolean(nextQuestionId && nextQuestionId !== lastQuestionId);
    const wasPaused = state.paused;

    state = {
      phase: nextPhase,
      durationMs: Number(nextState.durationMs) || 20000,
      deadline: nextState.deadline ? Number(nextState.deadline) : null,
      questionId: nextQuestionId,
      paused: Boolean(nextState.paused),
    };

    if (questionChanged) {
      chooseTheme(nextQuestionId);
      step = 0;
      timeUpPlayedFor = null;
      playQuestionStart();
      restartScheduler();
    } else if (phaseChanged && nextPhase === 'reveal') {
      playReveal();
      restartScheduler();
    } else if (wasPaused !== state.paused) {
      restartScheduler();
    }

    lastPhase = nextPhase;
    if (nextQuestionId) lastQuestionId = nextQuestionId;
  }

  async function start() {
    if (!ensureAudio()) return false;
    try {
      if (ctx.state !== 'running') await ctx.resume();
    } catch (error) {
      console.error('Impossible d’activer le son', error);
      return false;
    }
    enabled = true;
    step = 0;
    const theme = currentTheme();
    playTone(theme.roots[0] + 7, 0.08, theme.leadWave, 0.044, 0, 1900);
    playTone(theme.roots[0] + 14, 0.15, theme.leadWave, 0.052, 0.08, 2100);
    restartScheduler();
    return true;
  }

  function stop() {
    enabled = false;
    if (scheduler) {
      clearTimeout(scheduler);
      scheduler = null;
    }
  }

  async function toggle() {
    if (enabled) {
      stop();
      return false;
    }
    return start();
  }

  function setVolume(value) {
    volume = Math.max(0, Math.min(0.3, Number(value) || 0));
    if (master && ctx && ctx.state !== 'closed') master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
  }

  window.GrandQuizMusic = {
    start,
    stop,
    toggle,
    setVolume,
    sync,
    get enabled() { return enabled; },
    get available() { return Boolean(window.AudioContext || window.webkitAudioContext); },
  };
})();