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
  let submittedQuestionId = null;
  let selectedAnswerQuestionId = null;
  let selectedAnswerValue = null;
  let answerDraftQuestionId = null;
  let answerDraftValue = '';
  let answerNotice = '';
  let lastLocalSelectionAt = 0;
  let sendRevision = 0;
  let heartbeatTimer = null;
  let transport = null;

  function persist() {
    localStorage.setItem(storageKey, JSON.stringify({ playerId, name, team }));
  }

  function sendPresence(type = 'heartbeat') {
    if (!name || !joined) return;
    transport?.send(type, { playerId, name, team });
  }

  function startHeartbeat() {
    clearInterval(heartbeatTimer);
    sendPresence();
    heartbeatTimer = setInterval(() => sendPresence(), 4000);
  }

  function hasOwnAnswer(state, id) {
    return Boolean(state?.playerAnswers && Object.prototype.hasOwnProperty.call(state.playerAnswers, id));
  }

  function hasSubmitted() {
    const questionId = currentState?.question?.id;
    return Boolean(questionId && (
      submittedQuestionId === questionId ||
      currentState?.answeredPlayerIds?.includes(playerId)
    ));
  }

  function isSelected(value) {
    return selectedAnswerQuestionId === currentState?.question?.id && String(selectedAnswerValue) === String(value);
  }

  function statusLabel() {
    if (answerNotice) return answerNotice;
    if (hasSubmitted()) return '✅ Modifiable';
    return currentState?.question?.category || '';
  }

  function syncQuestionDom() {
    if (currentState?.phase !== 'question') return false;
    const question = currentState.question;
    if (!question || !app.querySelector('.mobile-question')) return false;

    const status = app.querySelector('.answer-status');
    if (status) status.textContent = statusLabel();

    app.querySelectorAll('.mobile-option').forEach((button) => {
      button.classList.toggle('chosen', isSelected(button.dataset.value));
    });

    const numericButton = document.getElementById('numericBtn');
    if (numericButton) numericButton.textContent = hasSubmitted() ? 'Modifier' : 'Envoyer';
    return true;
  }

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

  function join() {
    if (!name) return;
    joined = true;
    persist();
    transport.send('join', { playerId, name, team });
    startHeartbeat();
    render();
  }

  function handleMessage(message) {
    if (message.type === 'state') {
      const previousPhase = currentState?.phase || null;
      const previousQuestionId = currentState?.question?.id || null;
      currentState = message.payload;
      const nextQuestionId = currentState?.question?.id || null;

      if (previousQuestionId !== nextQuestionId) {
        submittedQuestionId = null;
        selectedAnswerQuestionId = nextQuestionId;
        selectedAnswerValue = null;
        answerDraftQuestionId = nextQuestionId;
        answerDraftValue = '';
        answerNotice = '';
        lastLocalSelectionAt = 0;
      }

      if (currentState.mode !== 'teams') team = 'Orange';

      if (nextQuestionId && hasOwnAnswer(currentState, playerId)) {
        const storedValue = String(currentState.playerAnswers[playerId]);
        const localSelectionIsFresh =
          selectedAnswerQuestionId === nextQuestionId &&
          Date.now() - lastLocalSelectionAt < 1400 &&
          String(selectedAnswerValue) !== storedValue;

        submittedQuestionId = nextQuestionId;
        if (!localSelectionIsFresh) {
          selectedAnswerQuestionId = nextQuestionId;
          selectedAnswerValue = storedValue;
          if (currentState.question?.type === 'numeric') answerDraftValue = storedValue;
        }
      } else if (nextQuestionId && currentState.answeredPlayerIds?.includes(playerId)) {
        submittedQuestionId = nextQuestionId;
      }

      const sameQuestionScreen =
        previousPhase === 'question' &&
        currentState.phase === 'question' &&
        previousQuestionId === nextQuestionId;

      if (sameQuestionScreen && syncQuestionDom()) return;
      render();
      return;
    }

    if (message.type === 'answer_ack') {
      const payload = message.payload || {};
      if (payload.playerId !== playerId) return;

      if (payload.accepted) {
        submittedQuestionId = payload.questionId;
        answerNotice = '';
      } else if (payload.reason === 'closed') {
        answerNotice = '⏱ Temps écoulé';
      } else {
        answerNotice = '⚠️ Non enregistrée';
      }
      syncQuestionDom();
    }
  }

  function myPlayer() {
    return currentState?.players?.find((player) => player.id === playerId);
  }

  function render() {
    if (!name || !joined) { renderJoin(); return; }

    if (!currentState || currentState.phase === 'lobby' || currentState.phase === 'setup') {
      const teamSwitch = currentState?.mode === 'teams'
        ? `<div style="margin-top:14px"><strong>Ton équipe</strong><div class="team-choice" style="margin-top:8px"><button id="waitTeamOrange" class="team-btn orange ${team === 'Orange' ? 'selected' : ''}">🟠 Orange</button><button id="waitTeamBlue" class="team-btn blue ${team === 'Bleue' ? 'selected' : ''}">🔵 Bleue</button></div></div>`
        : '';
      const score = myPlayer()?.score || 0;
      app.innerHTML = `<div class="join-title">✅ Tu es dans la partie !</div><div class="join-sub">${G.escapeHtml(name)} · score conservé : <strong>${score} pts</strong></div><div class="feedback">Joueurs inscrits : <strong>${currentState?.players?.length || 0}</strong><br><span class="muted">Tu peux fermer cette page et revenir avec le même téléphone.</span></div>${teamSwitch}`;
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
    const start = wasFocused ? previousInput.selectionStart : null;
    const end = wasFocused ? previousInput.selectionEnd : null;
    if (previousInput) draftName = previousInput.value.slice(0, 24);

    const teams = currentState?.mode === 'teams';
    app.innerHTML = `<div class="join-title">Rejoins la partie</div><div class="join-sub">Choisis ton pseudo${teams ? ' et ton équipe' : ''}</div><div class="field"><label for="nameInput">Pseudo</label><input id="nameInput" maxlength="24" value="${G.escapeHtml(draftName)}" placeholder="Ex : Magali" autocomplete="nickname" autocapitalize="words"></div>${teams ? `<div style="margin-top:14px"><strong>Équipe</strong><div class="team-choice" style="margin-top:8px"><button id="teamOrange" class="team-btn orange ${team === 'Orange' ? 'selected' : ''}">🟠 Orange</button><button id="teamBlue" class="team-btn blue ${team === 'Bleue' ? 'selected' : ''}">🔵 Bleue</button></div></div>` : ''}<button id="joinBtn" class="btn primary big" style="width:100%;margin-top:16px">JOUER 🚀</button>`;

    const input = document.getElementById('nameInput');
    input.addEventListener('input', () => { draftName = input.value.slice(0, 24); });
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') document.getElementById('joinBtn')?.click(); });
    document.getElementById('teamOrange')?.addEventListener('click', () => { draftName = input.value.slice(0, 24); team = 'Orange'; renderJoin(); });
    document.getElementById('teamBlue')?.addEventListener('click', () => { draftName = input.value.slice(0, 24); team = 'Bleue'; renderJoin(); });
    document.getElementById('joinBtn').addEventListener('click', () => {
      draftName = input.value.slice(0, 24);
      name = draftName.trim();
      if (!name) { input.focus(); return; }
      draftName = name;
      join();
    });

    if (wasFocused) {
      input.focus({ preventScroll: true });
      const max = input.value.length;
      input.setSelectionRange(Math.min(start ?? max, max), Math.min(end ?? max, max));
    }
  }

  async function sendAnswer(value) {
    const questionId = currentState?.question?.id;
    if (!questionId || currentState?.phase !== 'question') return;

    if (currentState.deadline && Date.now() >= Number(currentState.deadline)) {
      answerNotice = '⏱ Temps écoulé';
      syncQuestionDom();
      return;
    }

    const revision = ++sendRevision;
    const previousQuestionId = selectedAnswerQuestionId;
    const previousValue = selectedAnswerValue;
    const previousSubmitted = submittedQuestionId;

    selectedAnswerQuestionId = questionId;
    selectedAnswerValue = String(value);
    submittedQuestionId = questionId;
    answerNotice = '';
    lastLocalSelectionAt = Date.now();
    syncQuestionDom();

    const result = await transport.send('answer', {
      playerId,
      name,
      team,
      questionId,
      value,
      revision,
    });

    if (result === false && revision === sendRevision) {
      selectedAnswerQuestionId = previousQuestionId;
      selectedAnswerValue = previousValue;
      submittedQuestionId = previousSubmitted;
      answerNotice = '⚠️ Non enregistrée';
      syncQuestionDom();
    }
  }

  function renderQuestion() {
    const question = currentState.question;
    if (!question) return;

    const oldInput = document.getElementById('numericInput');
    const wasFocused = document.activeElement === oldInput;
    const start = wasFocused ? oldInput.selectionStart : null;
    const end = wasFocused ? oldInput.selectionEnd : null;
    if (oldInput && answerDraftQuestionId === question.id) answerDraftValue = oldInput.value;
    if (answerDraftQuestionId !== question.id) {
      answerDraftQuestionId = question.id;
      answerDraftValue = '';
    }

    let controls = '';
    if (question.type === 'mcq' || question.type === 'truefalse') {
      controls = `<div class="mobile-options">${question.options.map((option, index) => {
        const value = question.type === 'truefalse' ? (index === 0 ? 'true' : 'false') : index;
        return `<button class="mobile-option ${isSelected(value) ? 'chosen' : ''}" data-value="${value}">${G.escapeHtml(option)}</button>`;
      }).join('')}</div>`;
    } else if (question.type === 'numeric') {
      controls = `<div class="numeric-row"><input id="numericInput" inputmode="decimal" type="text" value="${G.escapeHtml(answerDraftValue)}" placeholder="Ta réponse" autocomplete="off"><button id="numericBtn" class="btn green">${hasSubmitted() ? 'Modifier' : 'Envoyer'}</button></div>`;
    } else {
      controls = `<button id="buzzBtn" class="big-buzzer" ${currentState.buzzedPlayerId ? 'disabled' : ''}>BUZZ !</button><div class="feedback">${currentState.buzzedPlayer ? `🚨 ${G.escapeHtml(currentState.buzzedPlayer)} a été le plus rapide !` : 'Appuie dès que tu connais la réponse.'}</div>`;
    }

    app.innerHTML = `<div class="mobile-meta"><span class="badge">Question ${currentState.questionNumber}/${currentState.totalQuestions}</span><span class="badge answer-status">${G.escapeHtml(statusLabel())}</span></div><div class="mobile-question">${G.escapeHtml(question.question)}</div>${controls}`;

    document.querySelectorAll('.mobile-option').forEach((button) => {
      button.addEventListener('click', () => sendAnswer(button.dataset.value));
    });

    const input = document.getElementById('numericInput');
    input?.addEventListener('input', () => {
      answerDraftQuestionId = question.id;
      answerDraftValue = input.value;
    });

    const submitNumeric = () => {
      if (!input) return;
      answerDraftValue = input.value;
      const value = answerDraftValue.trim();
      if (value !== '') sendAnswer(value.replace(',', '.'));
    };

    document.getElementById('numericBtn')?.addEventListener('click', submitNumeric);
    input?.addEventListener('keydown', (event) => { if (event.key === 'Enter') submitNumeric(); });
    document.getElementById('buzzBtn')?.addEventListener('click', () => transport.send('buzz', { playerId, name, team, questionId: question.id }));

    if (input && wasFocused) {
      input.focus({ preventScroll: true });
      const max = input.value.length;
      input.setSelectionRange(Math.min(start ?? max, max), Math.min(end ?? max, max));
    }
  }

  function renderReveal() {
    const result = currentState.lastResults?.[playerId] || { points: 0, correct: false };
    const score = myPlayer()?.score || 0;
    if (result.points > 0) G.confetti(35);
    app.innerHTML = `<div class="join-title">${result.points > 0 ? '🎉 Bien joué !' : '📺 Réponse'}</div><div class="feedback"><div>${G.escapeHtml(currentState.correctLabel || '')}</div><div class="points">+${result.points || 0} pts</div><div class="muted">Score total : ${score} pts</div></div><div class="join-sub reveal-explanation">${G.escapeHtml(currentState.question?.explanation || '')}</div>`;
  }

  function renderRanking(final) {
    const ranking = currentState.ranking || [];
    const position = currentState.mode === 'individual' ? ranking.findIndex((player) => player.id === playerId) : -1;
    const score = myPlayer()?.score || 0;
    app.innerHTML = `<div class="join-title">${final ? '🏆 Partie terminée' : '🏆 Classement'}</div><div class="feedback">${position >= 0 ? `Tu es <strong>${position + 1}${position === 0 ? 'er' : 'e'}</strong> avec <div class="points">${score} pts</div>` : 'Regarde le classement sur l’écran principal.'}</div>`;
  }

  window.addEventListener('pagehide', () => sendPresence('leave'));
  window.addEventListener('beforeunload', () => sendPresence('leave'));
  render();
})();
