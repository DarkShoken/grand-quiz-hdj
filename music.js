(() => {
  let ctx = null;
  let master = null;
  let timer = null;
  let step = 0;
  let enabled = false;
  let volume = 0.07;

  const tempo = 112;
  const stepMs = (60_000 / tempo) / 2;
  const bass = [48,48,55,55,52,52,57,57,48,48,55,55,52,52,43,43];
  const melody = [72,null,76,null,79,76,74,null,72,null,76,null,81,79,76,null];
  const chords = [60,64,67,60,64,67,57,60,64,57,60,64,55,59,62,55];

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

  function playNote(note, duration, type='sine', gainValue=0.12, delay=0){
    if(!ctx || !master || note == null) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = type;
    osc.frequency.value = midiToHz(note);
    filter.type = 'lowpass';
    filter.frequency.value = type === 'triangle' ? 1800 : 2600;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(filter);filter.connect(gain);gain.connect(master);
    osc.start(now);osc.stop(now + duration + 0.03);
  }

  function tick(){
    if(!enabled) return;
    const i = step % 16;
    playNote(bass[i], 0.18, 'triangle', 0.09);
    if(i % 2 === 0) playNote(chords[i], 0.24, 'sine', 0.05);
    if(melody[i] != null) playNote(melody[i], 0.15, 'square', 0.035, 0.02);
    if(i === 0 || i === 8) playNote(84, 0.08, 'sine', 0.025, 0.04);
    step += 1;
  }

  async function start(){
    ensureAudio();
    if(!ctx) return false;
    if(ctx.state === 'suspended') await ctx.resume();
    if(enabled) return true;
    enabled = true;
    tick();
    timer = window.setInterval(tick, stepMs);
    return true;
  }

  function stop(){
    enabled = false;
    if(timer){clearInterval(timer);timer=null;}
  }

  async function toggle(){
    if(enabled){stop();return false;}
    await start();return enabled;
  }

  function setVolume(value){
    volume = Math.max(0, Math.min(0.25, Number(value) || 0));
    if(master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
  }

  window.GrandQuizMusic = { start, stop, toggle, setVolume, get enabled(){return enabled;} };
})();
