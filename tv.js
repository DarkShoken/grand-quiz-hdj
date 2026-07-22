(() => {
  const G = window.GrandQuiz;
  const room = G.cleanRoom(G.qs('room', 'QUIZ'));
  G.setRoomInUrl(room);
  const lobbyView = document.getElementById('lobbyView');
  const gameView = document.getElementById('gameView');
  const stage = document.getElementById('stage');
  const connectionStatus = document.getElementById('connectionStatus');
  const joinQrOverlay = document.getElementById('joinQrOverlay');
  const musicButtons = [document.getElementById('musicToggle'), document.getElementById('musicToggleGame')].filter(Boolean);
  let currentState = null;
  let timer = null;

  document.getElementById('roomCode').textContent = room;
  document.getElementById('roomTop').textContent = room;
  document.querySelector('.join-room-code').textContent = room;

  const makeQr = (el, text) => new QRCode(el, { text, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M });
  makeQr(document.getElementById('qrPlay'), G.makePlayUrl(room));
  makeQr(document.getElementById('qrHost'), G.makeHostUrl(room));
  makeQr(document.getElementById('qrPlayGame'), G.makePlayUrl(room));

  document.getElementById('hostQrCard')?.addEventListener('click', (event) => {
    event.currentTarget.classList.toggle('flipped');
  });

  function updateMusicButtons(){
    const enabled=Boolean(window.GrandQuizMusic?.enabled);
    musicButtons.forEach((button)=>{
      button.textContent=enabled?'🔇 Couper la musique':'🎵 Activer la musique';
    });
  }

  async function toggleMusic(){
    await window.GrandQuizMusic?.toggle();
    window.GrandQuizMusic?.sync(currentState || { phase:'lobby' });
    updateMusicButtons();
  }
  musicButtons.forEach((button)=>button.addEventListener('click',toggleMusic));
  updateMusicButtons();

  const transport = G.createTransport({ room, role:'screen', onMessage: handleMessage, onStatus: ({ ready, mode }) => {
    connectionStatus.textContent = ready ? (mode === 'online' ? '🟢 En ligne' : '🟡 Démo locale') : 'Connexion…';
    connectionStatus.className = `badge ${ready ? 'ok' : 'warn'}`;
    if (ready) requestState();
  }});

  document.getElementById('closeJoinQr')?.addEventListener('click', () => {
    transport.send('join_qr_set', { visible:false });
    setJoinQrVisible(false);
  });

  function requestState(){ transport.send('state_request', { from:'screen' }); }
  setInterval(() => { if (!currentState || Date.now() - (currentState.updatedAt || 0) > 8000) requestState(); }, 3500);

  function handleMessage(msg){
    if (msg.type === 'state') { currentState = msg.payload; render(); }
  }

  function setJoinQrVisible(visible){
    const show = Boolean(visible && currentState && currentState.phase !== 'lobby' && currentState.phase !== 'setup');
    joinQrOverlay?.classList.toggle('hidden', !show);
    joinQrOverlay?.setAttribute('aria-hidden', show ? 'false' : 'true');
  }

  function playersArray(){ return currentState?.players || []; }

  function renderLobby(){
    window.GrandQuizMusic?.sync(currentState || { phase:'lobby' });
    lobbyView.classList.remove('hidden'); gameView.classList.add('hidden');
    setJoinQrVisible(false);
    const players = playersArray();
    document.getElementById('playerCount').textContent = players.length;
    document.getElementById('playerList').innerHTML = players.length ? players.map(p => `<div class="player-chip"><strong>${G.escapeHtml(p.name)}</strong>${currentState?.mode === 'teams' && p.team ? `<span class="badge">Équipe ${G.escapeHtml(p.team)}</span>` : ''}<span class="player-score-mini">${p.score || 0} pts</span></div>`).join('') : '<div class="muted">En attente des joueurs…</div>';
  }

  function render(){
    if (!currentState || currentState.phase === 'lobby' || currentState.phase === 'setup') { renderLobby(); return; }
    window.GrandQuizMusic?.sync(currentState);
    lobbyView.classList.add('hidden'); gameView.classList.remove('hidden');
    setJoinQrVisible(currentState.joinQrVisible);
    const answers = currentState.answerCount || 0;
    const totalPlayers = currentState.players?.length || 0;
    document.getElementById('answerCount').textContent = `${answers} / ${totalPlayers} réponse${answers > 1 ? 's' : ''}`;
    clearInterval(timer); timer = null;
    if (currentState.phase === 'question') renderQuestion();
    else if (currentState.phase === 'reveal') renderReveal();
    else if (currentState.phase === 'leaderboard') renderRanking(false);
    else if (currentState.phase === 'finished') renderRanking(true);
  }

  function renderQuestion(){
    const q = currentState.question; if (!q) return;
    const meta = `<div class="question-meta"><span class="badge">Question ${currentState.questionNumber}/${currentState.totalQuestions}</span><span class="badge">${G.escapeHtml(q.category)}</span><span class="badge">${G.escapeHtml(q.difficulty)}</span></div>`;
    let body = '';
    if (q.type === 'mcq' || q.type === 'truefalse') {
      body = `<div class="answer-grid">${q.options.map((opt,i)=>`<div class="answer-tile ${['a','b','c','d'][i] || 'a'}">${String.fromCharCode(65+i)} · ${G.escapeHtml(opt)}</div>`).join('')}</div>`;
    } else if (q.type === 'numeric') {
      body = '<div class="reveal-answer" style="color:var(--cyan)">🔢 Entrez votre réponse sur votre téléphone</div>';
    } else {
      body = `<div class="reveal-answer pulse" style="color:var(--red)">🚨 BUZZEZ !</div><div class="explanation">${currentState.buzzedPlayer ? `Le plus rapide : <strong>${G.escapeHtml(currentState.buzzedPlayer)}</strong>` : 'Le premier qui buzze obtient la main.'}</div>`;
    }
    stage.innerHTML = `<article class="question-card">${meta}<div class="question-text">${G.escapeHtml(q.question)}</div>${body}${q.type !== 'buzzer' ? '<div class="timer-wrap"><div id="timerValue" class="timer">20</div><div class="progress"><i id="timerBar"></i></div></div>' : ''}</article>`;
    if (q.type !== 'buzzer') startTimer();
  }

  function startTimer(){
    const update = () => {
      const duration = currentState.durationMs || 20000;
      const left = Math.max(0, (currentState.deadline || Date.now()) - Date.now());
      const sec = Math.ceil(left / 1000);
      const tv = document.getElementById('timerValue'); const bar = document.getElementById('timerBar');
      if (tv) tv.textContent = sec;
      if (bar) bar.style.width = `${Math.max(0, Math.min(100, left / duration * 100))}%`;
    };
    update(); timer = setInterval(update, 200);
  }

  function renderReveal(){
    const q = currentState.question; const correct = currentState.correctLabel || '';
    let options = '';
    if ((q.type === 'mcq' || q.type === 'truefalse') && q.options) {
      options = `<div class="answer-grid">${q.options.map((opt,i)=>`<div class="answer-tile ${['a','b','c','d'][i] || 'a'} ${i === currentState.correctIndex ? 'correct' : ''}">${String.fromCharCode(65+i)} · ${G.escapeHtml(opt)}</div>`).join('')}</div>`;
    }
    stage.innerHTML = `<article class="question-card"><div class="question-meta"><span class="badge">Réponse</span><span class="badge">${G.escapeHtml(q.category)}</span></div><div class="question-text">${G.escapeHtml(q.question)}</div>${options}<div class="reveal-answer">✅ ${G.escapeHtml(correct)}</div><div class="explanation">${G.escapeHtml(q.explanation || '')}</div></article>`;
    if (currentState.celebrate) G.confetti(80);
  }

  function renderRanking(final){
    const ranking = currentState.ranking || [];
    if (final) {
      const top = ranking.slice(0,3);
      const ordered = [top[1],top[0],top[2]].filter(Boolean);
      stage.innerHTML = `<article class="question-card"><div class="hero-kicker">${currentState.mode === 'teams' ? 'CLASSEMENT DES ÉQUIPES' : 'PODIUM FINAL'}</div><div class="question-text">🏆 ${currentState.mode === 'teams' ? 'Équipe gagnante' : 'Les champions du quiz'}</div><div class="podium">${ordered.map(p=>{const realPos=ranking.indexOf(p);return `<div class="podium-step ${realPos===0?'first':realPos===1?'second':'third'}"><div class="podium-medal">${['🥇','🥈','🥉'][realPos]}</div><div class="podium-name">${G.escapeHtml(p.name)}</div><div class="podium-score">${p.score} pts</div></div>`}).join('')}</div></article>`;
      G.confetti(130); return;
    }
    const medals = ['🥇','🥈','🥉'];
    stage.innerHTML = `<article class="question-card"><div class="hero-kicker">CLASSEMENT</div><div class="question-text">Qui prend la tête ?</div><div class="ranking">${ranking.slice(0,10).map((p,i)=>`<div class="rank-row"><div class="rank-pos">${medals[i] || i+1}</div><div class="rank-name">${G.escapeHtml(p.name)}</div><div class="rank-score">${p.score} pts</div></div>`).join('')}</div></article>`;
  }
})();
