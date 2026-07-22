(() => {
  let ctx = null;
  let master = null;
  let timer = null;
  let enabled = false;
  let volume = 0.065;
  let step = 0;
  let musicState = { phase:'lobby', durationMs:20000, deadline:null, questionId:null };
  let lastPhase = 'lobby';
  let lastQuestionId = null;
  let timeUpPlayedFor = null;

  const progression = [60, 65, 67, 60]; // C - F - G - C
  const melody = [7,null,9,7,12,null,9,7,4,null,7,4,9,null,7,null];
  const finalMelody = [12,9,7,9,12,14,16,14,12,9,7,9,12,14,16,19];

  function midiToHz(note){ return 440 * Math.pow(2, (note - 69) / 12); }

  function ensureAudio(){
    if(ctx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if(!AudioContextClass) return;
    ctx = new AudioContextClass();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }

  function playTone(note, duration=.16, type='triangle', gainValue=.08, delay=0, cutoff=2400){
    if(!ctx || !master || note == null) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = type;
    osc.frequency.value = midiToHz(note);
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002, gainValue), now + .012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(filter); filter.connect(gain); gain.connect(master);
    osc.start(now); osc.stop(now + duration + .04);
  }

  function playChord(root, gain=.025, duration=.32, delay=0){
    [0,4,7].forEach((interval,i)=>playTone(root+interval, duration, 'sine', gain, delay + i*.012, 2100));
  }

  function playClick(strong=false){
    const note = strong ? 91 : 86;
    playTone(note, .045, 'square', strong ? .028 : .018, 0, 5200);
  }

  function playQuestionStart(){
    if(!enabled || !ctx) return;
    playTone(72,.12,'triangle',.055,0);
    playTone(76,.12,'triangle',.05,.08);
    playTone(79,.18,'triangle',.055,.16);
  }

  function playReveal(){
    if(!enabled || !ctx) return;
    playTone(72,.14,'triangle',.045,0);
    playTone(76,.14,'triangle',.045,.07);
    playTone(79,.24,'triangle',.055,.14);
  }

  function playTimeUp(){
    if(!enabled || !ctx) return;
    playTone(79,.10,'square',.04,0);
    playTone(76,.10,'square',.04,.10);
    playTone(72,.22,'triangle',.055,.20);
  }

  function countdownInfo(){
    if(musicState.phase !== 'question' || !musicState.deadline) return null;
    const duration = Math.max(1000, Number(musicState.durationMs) || 20000);
    const remaining = Math.max(0, musicState.deadline - Date.now());
    const progress = Math.max(0, Math.min(1, 1 - remaining / duration));
    return { duration, remaining, progress };
  }

  function getTempo(){
    const info = countdownInfo();
    if(!info) return musicState.phase === 'lobby' ? 94 : 102;
    if(info.remaining <= 3000) return 178;
    if(info.remaining <= 6000) return 154;
    if(info.progress >= .68) return 138;
    if(info.progress >= .38) return 124;
    return 110;
  }

  function getStepMs(){ return (60_000 / getTempo()) / 2; }

  function tickLobby(){
    const i = step % 16;
    const root = progression[Math.floor(step / 8) % progression.length];
    if(i % 4 === 0) playTone(root - 12, .22, 'triangle', .045);
    if(i % 8 === 0) playChord(root, .016, .38, .02);
    if(i === 2 || i === 10) playTone(root + 7, .12, 'sine', .025, .02);
  }

  function tickQuestion(){
    const info = countdownInfo();
    if(!info) return;
    if(info.remaining <= 0){
      if(timeUpPlayedFor !== musicState.deadline){
        timeUpPlayedFor = musicState.deadline;
        playTimeUp();
      }
      return;
    }

    const i = step % 16;
    const root = progression[Math.floor(step / 8) % progression.length];
    const finalFive = info.remaining <= 5000;
    const finalThree = info.remaining <= 3000;

    if(i % 2 === 0) playTone(root - 12, finalFive ? .11 : .17, 'triangle', finalFive ? .07 : .052, 0, 1800);
    if(i % 4 === 0) playChord(root, finalFive ? .024 : .018, finalFive ? .22 : .32, .01);

    const pattern = finalFive ? finalMelody : melody;
    const offset = pattern[i];
    const playMelody = finalFive || i % 2 === 0;
    if(playMelody && offset != null){
      playTone(root + offset, finalThree ? .075 : .12, finalFive ? 'square' : 'triangle', finalFive ? .032 : .026, .018, finalFive ? 3600 : 2600);
    }

    if(finalFive){
      playClick(i % 2 === 0);
      if(finalThree && i % 2 === 1) playTone(84 + (i % 4), .055, 'sine', .02, .03, 5000);
    } else if(info.progress >= .68 && i % 4 === 2){
      playClick(false);
    }
  }

  function tickNeutral(){
    const i = step % 16;
    const root = progression[Math.floor(step / 8) % progression.length];
    if(i % 4 === 0) playTone(root - 12, .18, 'triangle', .04);
    if(i % 8 === 0) playChord(root, .014, .34, .015);
  }

  function schedule(){
    if(!enabled) return;
    if(musicState.phase === 'question') tickQuestion();
    else if(musicState.phase === 'lobby') tickLobby();
    else tickNeutral();
    step += 1;
    timer = window.setTimeout(schedule, getStepMs());
  }

  function restartScheduler(){
    if(timer){ clearTimeout(timer); timer = null; }
    if(!enabled) return;
    schedule();
  }

  function sync(nextState={}){
    const nextPhase = nextState.phase || 'lobby';
    const nextQuestionId = nextState.question?.id || nextState.questionId || null;
    const phaseChanged = nextPhase !== lastPhase;
    const questionChanged = nextQuestionId && nextQuestionId !== lastQuestionId;

    musicState = {
      phase: nextPhase,
      durationMs: Number(nextState.durationMs) || 20000,
      deadline: nextState.deadline || null,
      questionId: nextQuestionId
    };

    if(questionChanged){
      step = 0;
      timeUpPlayedFor = null;
      playQuestionStart();
    } else if(phaseChanged && nextPhase === 'reveal'){
      playReveal();
    }

    lastPhase = nextPhase;
    lastQuestionId = nextQuestionId || lastQuestionId;
    if(enabled && !timer) restartScheduler();
  }

  async function start(){
    ensureAudio();
    if(!ctx) return false;
    if(ctx.state === 'suspended') await ctx.resume();
    if(enabled) return true;
    enabled = true;
    step = 0;
    restartScheduler();
    return true;
  }

  function stop(){
    enabled = false;
    if(timer){ clearTimeout(timer); timer = null; }
  }

  async function toggle(){
    if(enabled){ stop(); return false; }
    await start(); return enabled;
  }

  function setVolume(value){
    volume = Math.max(0, Math.min(.22, Number(value) || 0));
    if(master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, .05);
  }

  window.GrandQuizMusic = {
    start, stop, toggle, setVolume, sync,
    get enabled(){ return enabled; }
  };
})();
