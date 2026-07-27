(() => {
  const G = window.GrandQuiz;
  const room = G.cleanRoom(G.qs('room', 'QUIZ'));
  const app = document.getElementById('app');
  const connection = document.getElementById('connection');
  document.getElementById('roomLabel').textContent = room;

  const storageKey = `grandquiz:${room}`;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch {}

  let playerId = saved.playerId || G.uid();
  let name = saved.name || '';
  let draftName = saved.name || '';
  let team = saved.team || 'Orange';
  let joined = false;
  let currentState = null;
  let answeredQuestionId = null;
  let pendingQuestionId = null;
  let answerDraftQuestionId = null;
  let answerDraftValue = '';
  let transport = null;

  transport = G.createTransport({
    room,
    role: 'player',
    onMessage: handleMessage,
    onStatus: ({ ready, mode }) => {
      connection.textContent = ready ? (mode === 'online' ? '🟢 Connecté' : '🟡 Démo locale') : 'Connexion…';
      connection.className = `badge ${ready ? 'ok' : 'warn'}`;
      if (ready) {
        setTimeout(() => {
          transport?.send('state_request', { from: 'player', playerId });
          if (name) join();
        }, 0);
      }
    },
  });

  function persist() {
    localStorage.setItem(storageKey, JSON.stringify({ playerId, name, team }));
  }

  function join() {
    if (!name) return;
    joined = true;
    persist();
    transport.send('join', { playerId, name, team });
    render();
  }

  function handleMessage(message) {
    if (message.type === 'state') {
      const previousQuestionId = currentState?.question?.id || null;
      currentState = message.payload;
      const nextQuestionId = currentState?.question?.id || null;
      if (previousQuestionId !== nextQuestionId) {
        answerDraftQuestionId = nextQuestionId;
        answerDraftValue = '';
        pendingQuestionId = null;
      }
      if (currentState.mode !== 'teams') team = 'Orange';
      if (currentState.question?.id && currentState.answeredPlayerIds?.includes(playerId)) answeredQuestionId = currentState.question.id;
      render();
      return;
    }

    if (message.type === 'answer_ack') {
      const payload = message.payload || {};
      if (payload.playerId !== playerId) return;
      if (payload.accepted) {
        answeredQuestionId = payload.questionId;
        pendingQuestionId = null;
      } else if (payload.questionId === pendingQuestionId) {
        pendingQuestionId = null;
      }
      render();
    }
  }

  function myPlayer() {
    return currentState?.players?.find((player) => player.id === playerId);
  }

  function render() {
    if (!name || !joined) {
      renderJoin();
      return;
    }

    if (!currentState || currentState.phase === 'lobby' || currentState.phase === 'setup') {
      const teamSwitch = currentState?.mode === 'teams'
        ? `<div style="margin-top:14px"><strong>Ton équipe</strong><div class="team-choice" style="margin-top:8px"><button id="waitTeamOrange" class="team-btn orange ${team === 'Orange' ? 'selected' : ''}">🟠 Orange</button><button id="waitTeamBlue" class="team-btn blue ${team === 'Bleue' ? 'selected' : ''}">🔵 Bleue</button></div></div>`
        : '';
      app.innerHTML = `<div class="join-title">✅ Tu es dans la partie !</div><div class="join-sub">${G.escapeHtml(name)} · regarde l’écran principal</div><div class="feedback">Joueurs connectés : <strong>${currentState?.players?.length || 0}</strong></div>${teamSwitch}`;
      document.getElementById('waitTeamOrange')?.addEventListener('click', () => changeTeam('Orange'));
      document.getElementById('waitTeamBlue')?.addEventListener('click', () => changeTeam('Bleue'));
      return;
    }

    if (currentState.phase === 'question') renderQuestion();
    else if (currentState.phase === 'reveal') renderReveal();
    else if (currentState.phase === 'leaderboard') renderRanking(false);
    else if (currentState.phase === 'finished') renderRanking(true);
  }

  function changeTeam(nextTeam) {
    team = nextTeam;
    persist();
    transport.send('join', { playerId, name, team });
    render();
  }

  function renderJoin() {
    const previousInput = document.getElementById('nameInput');
    const wasFocused = document.activeElement === previousInput;
    const selectionStart = wasFocused ? previousInput.selectionStart : null;
    const selectionEnd = wasFocused ? previousInput.selectionEnd : null;
    if (previousInput) draftName = previousInput.value.slice(0, 24);

    const teams = currentState?.mode === 'teams';
    app.innerHTML = `<div class="join-title">Rejoins la partie</div><div class="join-sub">Choisis ton pseudo${teams ? ' et ton équipe' : ''}</div><div class="field"><label for="nameInput">Pseudo</label><input id="nameInput" maxlength="24" value="${G.escapeHtml(draftName)}" placeholder="Ex : Magali" autocomplete="nickname" autocapitalize="words"></div>${teams ? `<div style="margin-top:14px"><strong>Équipe</strong><div class="team-choice" style="margin-top:8px"><button id="teamOrange" class="team-btn orange ${team === 'Orange' ? 'selected' : ''}">🟠 Orange</button><button id="teamBlue" class="team-btn blue ${team === 'Bleue' ? 'selected' : ''}">🔵 Bleue</button></div></div>` : ''}<button id="joinBtn" class="btn primary big" style="width:100%;margin-top:16px">JOUER 🚀</button>`;

    const nameInput = document.getElementById('nameInput');
    nameInput.addEventListener('input', () => { draftName = nameInput.value.slice(0, 24); });
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') document.getElementById('joinBtn')?.click();
    });

    document.getElementById('teamOrange')?.addEventListener('click', () => {
      draftName = nameInput.value.slice(0, 24);
      team = 'Orange';
      renderJoin();
    });
    document.getElementById('teamBlue')?.addEventListener('click', () => {
      draftName = nameInput.value.slice(0, 24);
      team = 'Bleue';
      renderJoin();
    });
    document.getElementById('joinBtn').addEventListener('click', () => {
      draftName = nameInput.value.slice(0, 24);
      name = draftName.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      draftName = name;
      join();
    });

    if (wasFocused) {
      nameInput.focus({ preventScroll: true });
      const max = nameInput.value.length;
      nameInput.setSelectionRange(Math.min(selectionStart ?? max, max), Math.min(selectionEnd ?? max, max));
    }
  }

  function alreadyAnswered() {
    const questionId = currentState?.question?.id;
    return Boolean(questionId && (answeredQuestionId === questionId || currentState?.answeredPlayerIds?.includes(playerId)));
  }

  async function sendAnswer(value) {
    const questionId = currentState?.question?.id;
    if (!questionId || alreadyAnswered() || pendingQuestionId === questionId) return;
    pendingQuestionId = questionId;
    renderQuestion();
    const result = await transport.send('answer', { playerId, name, team, questionId, value });
    if (result === false && pendingQuestionId === questionId) {
      pendingQuestionId = null;
      renderQuestion();
    }
  }

  function renderQuestion() {
    const question = currentState.question;
    if (!question) return;

    const previousAnswerInput = document.getElementById('numericInput');
    const answerWasFocused = document.activeElement === previousAnswerInput;
    const answerSelectionStart = answerWasFocused ? previousAnswerInput.selectionStart : null;
    const answerSelectionEnd = answerWasFocused ? previousAnswerInput.selectionEnd : null;
    if (previousAnswerInput && answerDraftQuestionId === question.id) answerDraftValue = previousAnswerInput.value;
    if (answerDraftQuestionId !== question.id) {
      answerDraftQuestionId = question.id;
      answerDraftValue = '';
    }

    const locked = alreadyAnswered();
    const pending = pendingQuestionId === question.id;
    let controls = '';

    if (question.type === 'mcq' || question.type === 'truefalse') {
      controls = `<div class="mobile-options">${question.options.map((option, index) => `<button class="mobile-option ${locked || pending ? 'locked' : ''}" data-value="${question.type === 'truefalse' ? (index === 0 ? 'true' : 'false') : index}" ${locked || pending ? 'disabled' : ''}>${String.fromCharCode(65 + index)} · ${G.escapeHtml(option)}</button>`).join('')}</div>`;
    } else if (question.type === 'numeric') {
      controls = `<div class="numeric-row"><input id="numericInput" inputmode="decimal" type="text" value="${G.escapeHtml(answerDraftValue)}" placeholder="Ta réponse" autocomplete="off" ${locked || pending ? 'disabled' : ''}><button id="numericBtn" class="btn green" ${locked || pending ? 'disabled' : ''}>Envoyer</button></div>`;
    } else {
      controls = `<button id="buzzBtn" class="big-buzzer" ${currentState.buzzedPlayerId ? 'disabled' : ''}>BUZZ !</button><div class="feedback">${currentState.buzzedPlayer ? `🚨 ${G.escapeHtml(currentState.buzzedPlayer)} a été le plus rapide !` : 'Appuie dès que tu connais la réponse.'}</div>`;
    }

    app.innerHTML = `<div style="display:flex;justify-content:space-between;gap:8px"><span class="badge">Question ${currentState.questionNumber}/${currentState.totalQuestions}</span><span class="badge">${G.escapeHtml(question.category)}</span></div><div class="mobile-question">${G.escapeHtml(question.question)}</div>${controls}${pending ? '<div class="feedback">⏳ Envoi de la réponse…</div>' : ''}${locked ? '<div class="feedback">✅ Réponse enregistrée. Regarde l’écran !</div>' : ''}`;

    document.querySelectorAll('.mobile-option').forEach((button) => button.addEventListener('click', () => sendAnswer(button.dataset.value)));

    const numericInput = document.getElementById('numericInput');
    numericInput?.addEventListener('input', () => {
      answerDraftQuestionId = question.id;
      answerDraftValue = numericInput.value;
    });
    document.getElementById('numericBtn')?.addEventListener('click', () => {
      answerDraftValue = numericInput.value;
      const value = answerDraftValue.trim();
      if (value !== '') sendAnswer(value.replace(',', '.'));
    });
    numericInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        answerDraftValue = event.currentTarget.value;
        const value = answerDraftValue.trim();
        if (value !== '') sendAnswer(value.replace(',', '.'));
      }
    });

    document.getElementById('buzzBtn')?.addEventListener('click', () => transport.send('buzz', { playerId, name, team, questionId: question.id }));

    if (numericInput && answerWasFocused && !numericInput.disabled) {
      numericInput.focus({ preventScroll: true });
      const max = numericInput.value.length;
      numericInput.setSelectionRange(Math.min(answerSelectionStart ?? max, max), Math.min(answerSelectionEnd ?? max, max));
    }
  }

  function renderReveal() {
    const result = currentState.lastResults?.[playerId] || { points: 0, correct: false };
    const score = myPlayer()?.score || 0;
    if (result.points > 0) G.confetti(35);
    app.innerHTML = `<div class="join-title">${result.points > 0 ? '🎉 Bien joué !' : '📺 Réponse'}</div><div class="feedback"><div>${G.escapeHtml(currentState.correctLabel || '')}</div><div class="points">+${result.points || 0} pts</div><div class="muted">Score total : ${score} pts</div></div><div class="join-sub" style="margin-top:14px">${G.escapeHtml(currentState.question?.explanation || '')}</div>`;
  }

  function renderRanking(final) {
    const ranking = currentState.ranking || [];
    let position = -1;
    if (currentState.mode === 'individual') position = ranking.findIndex((player) => player.id === playerId);
    const score = myPlayer()?.score || 0;
    app.innerHTML = `<div class="join-title">${final ? '🏆 Partie terminée' : '🏆 Classement'}</div><div class="feedback">${currentState.mode === 'individual' && position >= 0 ? `Tu es <strong>${position + 1}${position === 0 ? 'er' : 'e'}</strong> avec <div class="points">${score} pts</div>` : 'Regarde le classement sur l’écran principal.'}</div>`;
  }

  render();
})();
