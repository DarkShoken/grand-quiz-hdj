(() => {
  let ctx = null;
  let master = null;
  let compressor = null;
  let timer = null;
  let enabled = false;
  let volume = 0.16;
  let step = 0;
  let lastQuestionId = null;
  let lastPhase = 'lobby';
  let timeUpPlayedFor = null;
  let state = { phase: 'lobby', durationMs: 20000, deadline: null, questionId: null };

  const chordRoots = [60, 65, 67, 60];
  const calmMelody = [7, 9, 12, 9, 7, 4, 7, 9, 12, 14, 12, 9, 7, 4, 2, 4];
  const activeMelody = [7, 9, 12, 14, 12, 9, 7, 9, 12, 14, 16, 14, 12, 9, 7, 4];
  const urgentMelody = [12, 14, 16, 19, 16, 14, 12, 14, 16, 19, 21, 19, 16, 14, 12, 9];

  function midiToHz(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  function ensureAudio() {
    if (ctx && ctx.state !== 'closed') return true;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;

    ctx = new AudioContextClass();
    master = ctx.createGain();
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -22;
    compressor.knee.value = 20;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.18;
    master.gain.value = volume;
    master.connect(compressor);
    compressor.connect(ctx.destination);
    return true;
  }

  function playTone(note, duration = 0.14, type = 'triangle', gainValue = 0.08, delay = 0, cutoff = 2800) {
    if (!ctx || !master || note == null || ctx.state === 'closed') return;
    const when = ctx.currentTime + Math.max(0, delay);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = type;
    osc.frequency.setValueAtTime(midiToHz(note), when);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, when);
    filter.Q.value = 0.7;

    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(0.04, duration));

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + duration + 0.05);
  }

  function playChord(root, duration = 0.32, gainValue = 0.032, delay = 0) {
    [0, 4, 7].forEach((interval, index) => {
      playTone(root + interval, duration, 'sine', gainValue, delay + index * 0.012, 2300);
    });
  }

  function playPercussion(accent = false) {
    playTone(accent ? 91 : 87, accent ? 0.05 : 0.035, 'square', accent ? 0.045 : 0.025, 0, 6500);
  }

  function countdownInfo() {
    if (state.phase !== 'question' || !state.deadline) return null;
    const duration = Math.max(1000, Number(state.durationMs) || 20000);
    const remaining = Math.max(0, Number(state.deadline) - Date.now());
    const progress = Math.max(0, Math.min(1, 1 - remaining / duration));
    return { duration, remaining, progress };
  }

  function tempoForState() {
    const info = countdownInfo();
    if (!info) return state.phase === 'lobby' ? 92 : 84;

    if (info.remaining <= 2000 || info.progress >= 0.93) return 184;
    if (info.remaining <= 4000 || info.progress >= 0.82) return 158;
    if (info.progress >= 0.68) return 138;
    if (info.progress >= 0.48) return 122;
    if (info.progress >= 0.25) return 110;
    return 98;
  }

  function stepDelayMs() {
    return (60000 / tempoForState()) / 2;
  }

  function playLobbyStep() {
    const i = step % 16;
    const root = chordRoots[Math.floor(step / 8) % chordRoots.length];
    if (i % 4 === 0) playTone(root - 12, 0.2, 'triangle', 0.065, 0, 1700);
    if (i % 8 === 0) playChord(root, 0.42, 0.024, 0.015);
    if (i === 2 || i === 6 || i === 10 || i === 14) {
      playTone(root + calmMelody[i], 0.16, 'triangle', 0.038, 0.02, 2500);
    }
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

    const i = step % 16;
    const root = chordRoots[Math.floor(step / 8) % chordRoots.length];
    const level = info.progress >= 0.82 || info.remaining <= 4000
      ? 3
      : info.progress >= 0.68
        ? 2
        : info.progress >= 0.35
          ? 1
          : 0;

    const melody = level >= 3 ? urgentMelody : level >= 1 ? activeMelody : calmMelody;

    if (i % 2 === 0) {
      playTone(root - 12, level >= 2 ? 0.1 : 0.17, 'triangle', level >= 2 ? 0.09 : 0.072, 0, 1800);
    }
    if (i % 4 === 0) {
      playChord(root, level >= 2 ? 0.2 : 0.34, level >= 2 ? 0.04 : 0.03, 0.01);
    }

    const shouldPlayMelody = level >= 2 || i % 2 === 0;
    if (shouldPlayMelody) {
      playTone(
        root + melody[i],
        level >= 3 ? 0.07 : level >= 2 ? 0.1 : 0.14,
        level >= 3 ? 'square' : 'triangle',
        level >= 3 ? 0.052 : level >= 2 ? 0.045 : 0.038,
        0.018,
        level >= 3 ? 4300 : 3000,
      );
    }

    if (level >= 3) {
      playPercussion(i % 2 === 0);
    } else if (level === 2 && i % 2 === 0) {
      playPercussion(i % 4 === 0);
    } else if (level === 1 && i % 4 === 2) {
      playPercussion(false);
    }
  }

  function playNeutralStep() {
    const i = step % 16;
    const root = chordRoots[Math.floor(step / 8) % chordRoots.length];
    if (i % 8 === 0) playChord(root, 0.38, 0.02, 0.01);
    if (i % 4 === 0) playTone(root - 12, 0.19, 'triangle', 0.052, 0, 1600);
  }

  function playQuestionStart() {
    if (!enabled || !ctx) return;
    playTone(72, 0.11, 'triangle', 0.07, 0);
    playTone(76, 0.11, 'triangle', 0.07, 0.08);
    playTone(79, 0.2, 'triangle', 0.08, 0.16);
  }

  function playReveal() {
    if (!enabled || !ctx) return;
    playTone(67, 0.12, 'triangle', 0.055, 0);
    playTone(72, 0.12, 'triangle', 0.06, 0.08);
    playTone(76, 0.22, 'triangle', 0.07, 0.16);
  }

  function playTimeUp() {
    if (!enabled || !ctx) return;
    playTone(79, 0.09, 'square', 0.06, 0);
    playTone(76, 0.09, 'square', 0.06, 0.09);
    playTone(72, 0.24, 'triangle', 0.08, 0.18);
  }

  function schedule() {
    if (!enabled) return;
    if (state.phase === 'question') playQuestionStep();
    else if (state.phase === 'lobby') playLobbyStep();
    else playNeutralStep();
    step += 1;
    timer = window.setTimeout(schedule, stepDelayMs());
  }

  function restartScheduler() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (enabled) schedule();
  }

  function sync(nextState = {}) {
    const nextPhase = nextState.phase || 'lobby';
    const nextQuestionId = nextState.question?.id || nextState.questionId || null;
    const phaseChanged = nextPhase !== lastPhase;
    const questionChanged = Boolean(nextQuestionId && nextQuestionId !== lastQuestionId);

    state = {
      phase: nextPhase,
      durationMs: Number(nextState.durationMs) || 20000,
      deadline: nextState.deadline ? Number(nextState.deadline) : null,
      questionId: nextQuestionId,
    };

    if (questionChanged) {
      step = 0;
      timeUpPlayedFor = null;
      playQuestionStart();
      restartScheduler();
    } else if (phaseChanged && nextPhase === 'reveal') {
      playReveal();
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
    playTone(72, 0.08, 'triangle', 0.055, 0);
    playTone(79, 0.14, 'triangle', 0.065, 0.08);
    restartScheduler();
    return true;
  }

  function stop() {
    enabled = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
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
    if (master && ctx && ctx.state !== 'closed') {
      master.gain.setTargetAtTime(volume, ctx.currentTime, 0.04);
    }
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