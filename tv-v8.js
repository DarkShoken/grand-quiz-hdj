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

  function makeQr(element, text, size) {
    if (!element) return;
    element.innerHTML = '';
    new QRCode(element, { text, width: size, height: size, correctLevel: QRCode.CorrectLevel.M });
  }

  makeQr(document.getElementById('qrPlay'), G.makePlayUrl(room), 176);
  makeQr(document.getElementById('qrHost'), G.makeHostUrl(room), 132);
  makeQr(document.getElementById('qrPlayGame'), G.makePlayUrl(room), 210);

  document.getElementById('hostQrCard')?.addEventListener('click', (event) => event.currentTarget.classList.toggle('flipped'));

  function setMusicButtonsText(text) {
    musicButtons.forEach((button) => { button.textContent = text; });
  }

  function updateMusicButtons() {
    const engine = window.GrandQuizMusic;
    if (!engine?.available) {
      setMusicButtonsText('⚠️ Audio indisponible');
      musicButtons.forEach((button) => { button.disabled = true; });
      return;
    }
    musicButtons.forEach((button) => { button.disabled = false; });
    setMusicButtonsText(engine.enabled ? '🔇 Couper la musique' : '🎵 Activer la musique');
  }

  async function toggleMusic() {
    const engine = window.GrandQuizMusic;
    if (!engine?.available) { updateMusicButtons(); return; }
    engine.sync(currentState || { phase: 'lobby' });
    musicButtons.forEach((button) => { button.disabled = true; });
    try {
      const result = await engine.toggle();
      if (!result && !engine.enabled) setMusicButtonsText('🎵 Activer la musique');
    } catch (error) {
      console.error('Activation audio impossible', error);
      setMusicButtonsText('⚠️ Audio bloqué');
    }
    updateMusicButtons();
  }

  musicButtons.forEach((button) => button.addEventListener('click', toggleMusic));
  updateMusicButtons();

  function requestState() { transport.send('state_request', { from: 'screen' }); }

  const transport = G.createTransport({
    room,
    role: 'screen',
    onMessage: (message) => {
      if (message.type !== 'state') return;
      applyState(message.payload);
    },
    onStatus: ({ ready, mode }) => {
      connectionStatus.textContent = ready ? (mode === 'online' ? '🟢 En ligne' : '🟡 Démo locale') : 'Connexion…';
      connectionStatus.className = `badge ${ready ? 'ok' : 'warn'}`;
      if (ready) requestState();
    },
  });

  setInterval(() => {
    if (!currentState || Date.now() - (currentState.updatedAt || 0) > 8000) requestState();
  }, 3500);

  document.getElementById('closeJoinQr')?.addEventListener('click', () => {
    transport.send('join_qr_set', { visible: false });
    setJoinQrVisible(false);
  });

  function setJoinQrVisible(visible) {
    const show = Boolean(visible && currentState && !['lobby', 'setup'].includes(currentState.phase));
    joinQrOverlay?.classList.toggle('hidden', !show);
    joinQrOverlay?.setAttribute('aria-hidden', show ? 'false' : 'true');
  }

  function playersArray() { return currentState?.players || []; }

  function updateAnswerCount() {
    const answers = currentState?.answerCount || 0;
    const totalPlayers = currentState?.players?.length || 0;
    const node = document.getElementById('answerCount');
    const text = `${answers} / ${totalPlayers} réponse${answers > 1 ? 's' : ''}`;
    if (node && node.textContent !== text) node.textContent = text;
  }

  function updateBuzzerStatus() {
    if (currentState?.phase !== 'question' || currentState?.question?.type !== 'buzzer') return;
    const node = stage.querySelector('.buzzer-status');
    if (!node) return;
    const nextHtml = currentState.buzzedPlayer
      ? `Le plus rapide : <strong>${G.escapeHtml(currentState.buzzedPlayer)}</strong>`
      : 'Le premier qui buzze obtient la main.';
    if (node.innerHTML !== nextHtml) node.innerHTML = nextHtml;
  }

  function applyState(nextState) {
    const previous = currentState;
    const previousPhase = previous?.phase || null;
    const previousQuestionId = previous?.question?.id || null;
    const previousJoinQrVisible = Boolean(previous?.joinQrVisible);
    const previousBuzzedPlayer = previous?.buzzedPlayer || null;

    currentState = nextState;

    const nextPhase = currentState?.phase || null;
    const nextQuestionId = currentState?.question?.id || null;
    const sameQuestionScreen = Boolean(
      previous &&
      previousPhase === nextPhase &&
      previousQuestionId === nextQuestionId &&
      ['question', 'reveal'].includes(nextPhase)
    );

    if (sameQuestionScreen) {
      window.GrandQuizMusic?.sync(currentState);
      updateAnswerCount();
      if (previousJoinQrVisible !== Boolean(currentState.joinQrVisible)) setJoinQrVisible(currentState.joinQrVisible);
      if (previousBuzzedPlayer !== (currentState.buzzedPlayer || null)) updateBuzzerStatus();
      return;
    }

    render();
  }

  function renderLobby() {
    clearInterval(timer); timer = null;
    window.GrandQuizMusic?.sync(currentState || { phase: 'lobby' });
    lobbyView.classList.remove('hidden');
    gameView.classList.add('hidden');
    setJoinQrVisible(false);
    const players = playersArray();
    document.getElementById('playerCount').textContent = players.length;
    document.getElementById('playerList').innerHTML = players.length
      ? players.map((player) => `<div class="player-chip ${player.online === false ? 'player-offline' : ''}"><strong>${G.escapeHtml(player.name)}</strong>${currentState?.mode === 'teams' && player.team ? `<span class="badge">Équipe ${G.escapeHtml(player.team)}</span>` : ''}<span class="player-score-mini">${player.score || 0} pts</span></div>`).join('')
      : '<div class="muted">En attente des joueurs…</div>';
  }

  function render() {
    if (!currentState || ['lobby', 'setup'].includes(currentState.phase)) { renderLobby(); return; }
    window.GrandQuizMusic?.sync(currentState);
    lobbyView.classList.add('hidden');
    gameView.classList.remove('hidden');
    setJoinQrVisible(currentState.joinQrVisible);
    updateAnswerCount();
    clearInterval(timer); timer = null;

    if (currentState.phase === 'question') renderQuestion();
    else if (currentState.phase === 'reveal') renderReveal();
    else if (currentState.phase === 'leaderboard') renderRanking(false);
    else if (currentState.phase === 'finished') renderRanking(true);
  }

  function compactClass(question) {
    const questionLength = String(question?.question || '').length;
    const longestOption = Math.max(0, ...(question?.options || []).map((option) => String(option).length));
    if (questionLength > 145 || longestOption > 65) return 'ultra-compact';
    if (questionLength > 95 || longestOption > 42) return 'compact';
    return '';
  }

  function scoreGroups(ranking) {
    const sorted = [...(ranking || [])].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'fr'));
    const groups = [];
    for (const player of sorted) {
      const score = Number(player.score) || 0;
      let group = groups[groups.length - 1];
      if (!group || group.score !== score) {
        group = { rank: groups.length + 1, score, players: [] };
        groups.push(group);
      }
      group.players.push(player);
    }
    return groups;
  }

  function denseRanking(ranking) {
    return scoreGroups(ranking).flatMap((group) => group.players.map((player) => ({ ...player, denseRank: group.rank })));
  }

  function renderQuestion() {
    const question = currentState.question;
    if (!question) return;
    const meta = `<div class="question-meta"><span class="badge">Question ${currentState.questionNumber}/${currentState.totalQuestions}</span><span class="badge">${G.escapeHtml(question.category)}</span><span class="badge">${G.escapeHtml(question.difficulty)}</span></div>`;
    let body = '';

    if (question.type === 'mcq' || question.type === 'truefalse') {
      body = `<div class="answer-grid">${question.options.map((option, index) => `<div class="answer-tile ${['a', 'b', 'c', 'd'][index] || 'a'}">${G.escapeHtml(option)}</div>`).join('')}</div>`;
    } else if (question.type === 'numeric') {
      body = '<div class="numeric-instruction">🔢 Entrez votre réponse sur votre téléphone</div>';
    } else {
      body = `<div class="buzzer-instruction pulse">🚨 BUZZEZ !</div><div class="explanation buzzer-status">${currentState.buzzedPlayer ? `Le plus rapide : <strong>${G.escapeHtml(currentState.buzzedPlayer)}</strong>` : 'Le premier qui buzze obtient la main.'}</div>`;
    }

    stage.innerHTML = `<article class="question-card ${compactClass(question)}">${meta}<div class="question-text">${G.escapeHtml(question.question)}</div>${body}${question.type !== 'buzzer' ? `<div class="timer-wrap"><div id="timerValue" class="timer">${Math.ceil((currentState.durationMs || 20000) / 1000)}</div><div class="progress"><i id="timerBar"></i></div></div>` : ''}</article>`;
    if (question.type !== 'buzzer') startQuestionTimer();
  }

  function startQuestionTimer() {
    const update = () => {
      const duration = currentState.durationMs || 20000;
      const left = Math.max(0, (currentState.deadline || Date.now()) - Date.now());
      const circle = document.getElementById('timerValue');
      const bar = document.getElementById('timerBar');
      if (circle) circle.textContent = Math.ceil(left / 1000);
      if (bar) bar.style.width = `${Math.max(0, Math.min(100, left / duration * 100))}%`;
    };
    update();
    timer = setInterval(update, 100);
  }

  function renderReveal() {
    const question = currentState.question;
    const correct = currentState.correctLabel || '';
    let options = '';
    if ((question.type === 'mcq' || question.type === 'truefalse') && question.options) {
      options = `<div class="answer-grid reveal-grid">${question.options.map((option, index) => `<div class="answer-tile ${['a', 'b', 'c', 'd'][index] || 'a'} ${index === currentState.correctIndex ? 'correct' : ''}">${G.escapeHtml(option)}</div>`).join('')}</div>`;
    }
    stage.innerHTML = `<article class="question-card reveal-card ${compactClass(question)}"><div class="question-meta"><span class="badge">Réponse</span><span class="badge">${G.escapeHtml(question.category)}</span></div><div class="question-text">${G.escapeHtml(question.question)}</div>${options}<div class="reveal-answer">✅ ${G.escapeHtml(correct)}</div><div class="explanation reveal-explanation">${G.escapeHtml(question.explanation || '')}</div><div class="reveal-auto-countdown"><div id="tvRevealTimer" class="timer reveal-timer">15</div><div class="reveal-auto-label">Prochaine question</div></div></article>`;
    if (currentState.celebrate) G.confetti(70);
    startRevealTimer();
  }

  function startRevealTimer() {
    const update = () => {
      const left = Math.max(0, (currentState.revealDeadline || Date.now()) - Date.now());
      const circle = document.getElementById('tvRevealTimer');
      if (circle) circle.textContent = Math.ceil(left / 1000);
    };
    update();
    timer = setInterval(update, 100);
  }

  function renderRanking(final) {
    const ranking = currentState.ranking || [];
    if (final) {
      const groups = scoreGroups(ranking).slice(0, 3);
      const ordered = [groups[1], groups[0], groups[2]].filter(Boolean);
      stage.innerHTML = `<article class="question-card ranking-card"><div class="hero-kicker">${currentState.mode === 'teams' ? 'CLASSEMENT DES ÉQUIPES' : 'PODIUM FINAL'}</div><div class="question-text">🏆 ${currentState.mode === 'teams' ? 'Équipe gagnante' : 'Les champions du quiz'}</div><div class="podium">${ordered.map((group) => {
        const medal = ['🥇', '🥈', '🥉'][group.rank - 1] || '';
        const stepClass = group.rank === 1 ? 'first' : group.rank === 2 ? 'second' : 'third';
        const names = group.players.map((player) => `<div class="podium-name">${G.escapeHtml(player.name)}</div>`).join('');
        const tie = group.players.length > 1 ? `<div class="podium-tie-label">EX ÆQUO · ${group.players.length}</div>` : '';
        return `<div class="podium-step ${stepClass}"><div class="podium-medal">${medal}</div>${names}${tie}<div class="podium-score">${group.score} pts</div></div>`;
      }).join('')}</div></article>`;
      G.confetti(120);
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const rows = denseRanking(ranking).slice(0, 10);
    stage.innerHTML = `<article class="question-card ranking-card"><div class="hero-kicker">CLASSEMENT</div><div class="question-text">Qui prend la tête ?</div><div class="ranking">${rows.map((player) => `<div class="rank-row"><div class="rank-pos">${medals[player.denseRank - 1] || player.denseRank}</div><div class="rank-name">${G.escapeHtml(player.name)}${rows.filter((other) => other.denseRank === player.denseRank).length > 1 ? ' <small>ex æquo</small>' : ''}</div><div class="rank-score">${player.score} pts</div></div>`).join('')}</div></article>`;
  }
})();
