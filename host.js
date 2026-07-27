(() => {
  const G = window.GrandQuiz;
  const BANK = window.GRAND_QUIZ_QUESTIONS || [];
  const USED_QUESTIONS_KEY = 'grand-quiz-used-questions-v1';

  let room = G.cleanRoom(G.qs('room', 'QUIZ'));
  let transport = null;
  let timer = null;
  let selectedQuestions = [];
  let currentQuestion = null;
  let generating = false;

  const players = new Map();
  const answers = new Map();

  let state = {
    phase: 'lobby',
    mode: 'individual',
    difficulty: 'Mixte',
    questionIndex: -1,
    totalQuestions: 0,
    question: null,
    answerCount: 0,
    durationMs: 20000,
    deadline: null,
    buzzedPlayer: null,
    ranking: [],
    lastResults: {},
    joinQrVisible: false,
    updatedAt: Date.now(),
  };

  const roomInput = document.getElementById('roomInput');
  const connection = document.getElementById('connection');
  const hostStage = document.getElementById('hostStage');
  const joinQrBtn = document.getElementById('joinQrBtn');
  const startBtn = document.getElementById('startBtn');
  const generationStatus = document.getElementById('generationStatus');
  const questionSourceSelect = document.getElementById('questionSourceSelect');

  roomInput.value = room;
  G.setRoomInUrl(room);

  const categories = [...new Set(BANK.map((q) => q.category))].sort();
  document.getElementById('categories').innerHTML = categories
    .map((category, index) => `<label class="check"><input type="checkbox" value="${G.escapeHtml(category)}" ${index < 10 ? 'checked' : ''}> <span>${G.escapeHtml(category)}</span></label>`)
    .join('');

  function normalizeQuestionText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function loadUsedQuestions() {
    try {
      const parsed = JSON.parse(localStorage.getItem(USED_QUESTIONS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(Boolean).slice(-200) : [];
    } catch {
      return [];
    }
  }

  function rememberQuestions(questions) {
    const previous = loadUsedQuestions();
    const additions = questions.map((q) => String(q.question || '').trim()).filter(Boolean);
    const seen = new Set();
    const merged = [...previous, ...additions].filter((question) => {
      const key = normalizeQuestionText(question);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(-200);
    localStorage.setItem(USED_QUESTIONS_KEY, JSON.stringify(merged));
  }

  function setGenerationStatus(text, kind = 'muted') {
    if (!generationStatus) return;
    generationStatus.textContent = text;
    generationStatus.style.color = kind === 'error' ? '#ff9cb1' : kind === 'ok' ? '#7bf8d3' : '';
  }

  function setGenerating(value) {
    generating = value;
    startBtn.disabled = value;
    startBtn.textContent = value ? '✨ Création des questions…' : '✨ Créer et lancer la partie';
  }

  function connect() {
    transport?.close();
    transport = G.createTransport({
      room,
      role: 'host',
      onMessage: handleMessage,
      onStatus: ({ ready, mode }) => {
        connection.textContent = ready ? (mode === 'online' ? '🟢 En ligne' : '🟡 Démo locale') : 'Connexion…';
        connection.className = `badge ${ready ? 'ok' : 'warn'}`;
        if (ready) broadcastState();
      },
    });
    updateLinks();
  }

  function updateLinks() {
    document.getElementById('screenLink').href = new URL(`index.html?room=${room}`, location.href).href;
    document.getElementById('playerLink').href = G.makePlayUrl(room);
  }

  roomInput.addEventListener('change', () => {
    room = G.cleanRoom(roomInput.value);
    roomInput.value = room;
    G.setRoomInUrl(room);
    players.clear();
    answers.clear();
    state.phase = 'lobby';
    state.joinQrVisible = false;
    connect();
    render();
  });

  function upsertPlayer(payload) {
    if (!payload?.playerId) return null;
    const existing = players.get(payload.playerId);
    const player = {
      id: payload.playerId,
      name: String(payload.name || existing?.name || 'Joueur').slice(0, 24),
      team: payload.team === 'Bleue' ? 'Bleue' : (existing?.team || 'Orange'),
      score: existing?.score || 0,
    };
    players.set(player.id, player);
    return player;
  }

  function publicPlayers() {
    return [...players.values()].map(({ id, name, team, score }) => ({ id, name, team, score }));
  }

  function ranking() {
    if (state.mode === 'teams') {
      const totals = { Orange: 0, Bleue: 0 };
      for (const player of players.values()) totals[player.team === 'Bleue' ? 'Bleue' : 'Orange'] += player.score || 0;
      return Object.entries(totals)
        .map(([name, score]) => ({ name: `Équipe ${name}`, score }))
        .sort((a, b) => b.score - a.score);
    }
    return [...players.values()]
      .map((player) => ({ id: player.id, name: player.name, score: player.score || 0 }))
      .sort((a, b) => b.score - a.score);
  }

  function sanitizeQuestion(question) {
    if (!question) return null;
    const base = {
      id: question.id,
      category: question.category,
      difficulty: question.difficulty,
      type: question.type,
      question: question.question,
      explanation: question.explanation || '',
    };
    if (question.type === 'mcq') base.options = question.options;
    if (question.type === 'truefalse') base.options = ['Vrai', 'Faux'];
    if (question.type === 'numeric') base.unit = question.unit || '';
    return base;
  }

  function snapshot() {
    return {
      ...state,
      room,
      players: publicPlayers(),
      ranking: ranking(),
      answeredPlayerIds: [...answers.keys()],
      updatedAt: Date.now(),
    };
  }

  function updateJoinQrButton() {
    if (!joinQrBtn) return;
    joinQrBtn.textContent = state.joinQrVisible ? '✕ Masquer le QR joueurs sur la TV' : '📱 Afficher le QR joueurs sur la TV';
    joinQrBtn.classList.toggle('danger', Boolean(state.joinQrVisible));
    joinQrBtn.classList.toggle('primary', !state.joinQrVisible);
  }

  function broadcastState() {
    state.updatedAt = Date.now();
    transport?.send('state', snapshot());
    renderMetrics();
    updateJoinQrButton();
  }

  function standardAnswerResult(question, answer) {
    let correct = false;
    if (question.type === 'mcq') correct = Number(answer.value) === Number(question.answer);
    if (question.type === 'truefalse') correct = String(answer.value) === String(question.answer);
    let points = 0;
    if (correct) {
      points = 1000;
      if (state.speedBonus) points += Math.max(0, Math.round(500 * (1 - Math.min(1, answer.elapsed / state.durationMs))));
    }
    return { correct, points };
  }

  function handleMessage(message) {
    const payload = message.payload || {};
    if (message.type === 'state_request') {
      broadcastState();
      return;
    }
    if (message.type === 'join_qr_set') {
      state.joinQrVisible = Boolean(payload.visible);
      broadcastState();
      render();
      return;
    }
    if (message.type === 'join') {
      upsertPlayer(payload);
      broadcastState();
      render();
      return;
    }
    if (message.type === 'answer' && state.phase === 'question' && currentQuestion && currentQuestion.type !== 'buzzer') {
      if (!payload.playerId || payload.questionId !== currentQuestion.id) {
        transport?.send('answer_ack', { playerId: payload.playerId, questionId: payload.questionId, accepted: false });
        return;
      }
      const player = upsertPlayer(payload);
      if (!player || answers.has(payload.playerId)) {
        transport?.send('answer_ack', { playerId: payload.playerId, questionId: payload.questionId, accepted: true });
        return;
      }
      const answer = {
        value: payload.value,
        answeredAt: Date.now(),
        elapsed: Math.max(0, Date.now() - (state.startedAt || Date.now())),
      };
      if (currentQuestion.type === 'mcq' || currentQuestion.type === 'truefalse') {
        const result = standardAnswerResult(currentQuestion, answer);
        answer.correct = result.correct;
        answer.points = result.points;
        player.score = (player.score || 0) + result.points;
      }
      answers.set(payload.playerId, answer);
      state.answerCount = answers.size;
      transport?.send('answer_ack', { playerId: payload.playerId, questionId: payload.questionId, accepted: true });
      broadcastState();
      render();
      return;
    }
    if (message.type === 'buzz' && state.phase === 'question' && currentQuestion?.type === 'buzzer' && !state.buzzedPlayerId) {
      const player = upsertPlayer(payload);
      if (!player) return;
      state.buzzedPlayerId = player.id;
      state.buzzedPlayer = player.name;
      broadcastState();
      render();
    }
  }

  function selectedCategories() {
    return [...document.querySelectorAll('#categories input:checked')].map((input) => input.value);
  }

  function localQuestionPool(categoriesWanted, difficulty, count, excludedTexts = []) {
    const excluded = new Set(excludedTexts.map(normalizeQuestionText));
    const exact = BANK.filter((question) =>
      categoriesWanted.includes(question.category) &&
      (difficulty === 'Mixte' || question.difficulty === difficulty) &&
      !excluded.has(normalizeQuestionText(question.question))
    );
    const recycled = BANK.filter((question) =>
      categoriesWanted.includes(question.category) &&
      (difficulty === 'Mixte' || question.difficulty === difficulty) &&
      !exact.includes(question)
    );
    return [...G.shuffle(exact), ...G.shuffle(recycled)].slice(0, count);
  }

  async function generateQuestionsWithAI(categoriesWanted, difficulty, count) {
    const response = await fetch('/api/generate-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categories: categoriesWanted,
        difficulty,
        count,
        exclude: loadUsedQuestions().slice(-80),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'La génération IA a échoué.');
    if (!Array.isArray(data.questions) || !data.questions.length) throw new Error('Aucune question n’a été générée.');
    return data.questions;
  }

  async function startGame() {
    if (generating) return;
    const categoriesWanted = selectedCategories();
    if (!categoriesWanted.length) {
      alert('Sélectionne au moins une catégorie.');
      return;
    }

    const count = Number(document.getElementById('countSelect').value) || 15;
    const difficulty = document.getElementById('difficultySelect').value || 'Mixte';
    const source = questionSourceSelect.value;

    state.mode = document.getElementById('modeSelect').value;
    state.difficulty = difficulty;
    state.durationMs = Number(document.getElementById('durationSelect').value) || 20000;
    state.speedBonus = document.getElementById('speedSelect').value === 'on';
    state.joinQrVisible = false;

    setGenerating(true);
    let questions = [];

    try {
      if (source === 'ai') {
        setGenerationStatus(`L’IA prépare ${count} questions ${difficulty === 'Mixte' ? 'de difficulté variée' : difficulty.toLowerCase()}…`);
        try {
          questions = await generateQuestionsWithAI(categoriesWanted, difficulty, count);
          const missing = count - questions.length;
          if (missing > 0) {
            questions.push(...localQuestionPool(categoriesWanted, difficulty, missing, questions.map((q) => q.question)));
          }
          setGenerationStatus(`${questions.length} nouvelles questions prêtes.`, 'ok');
        } catch (error) {
          console.error(error);
          questions = localQuestionPool(categoriesWanted, difficulty, count, loadUsedQuestions());
          setGenerationStatus(`IA indisponible : ${error.message} Banque locale utilisée en secours.`, 'error');
        }
      } else {
        questions = localQuestionPool(categoriesWanted, difficulty, count, loadUsedQuestions());
        setGenerationStatus(`${questions.length} questions chargées depuis la banque locale.`, 'ok');
      }

      if (!questions.length) {
        alert('Aucune question disponible avec ces catégories et cette difficulté.');
        return;
      }

      selectedQuestions = questions.slice(0, count);
      rememberQuestions(selectedQuestions);
      for (const player of players.values()) player.score = 0;
      state.totalQuestions = selectedQuestions.length;
      state.questionIndex = -1;
      state.lastResults = {};
      state.ranking = [];
      nextQuestion();
    } finally {
      setGenerating(false);
    }
  }

  function nextQuestion() {
    clearTimeout(timer);
    answers.clear();
    state.answerCount = 0;
    state.buzzedPlayer = null;
    state.buzzedPlayerId = null;
    state.lastResults = {};
    state.questionIndex += 1;
    if (state.questionIndex >= selectedQuestions.length) {
      finishGame();
      return;
    }
    currentQuestion = selectedQuestions[state.questionIndex];
    state.phase = 'question';
    state.question = sanitizeQuestion(currentQuestion);
    state.questionNumber = state.questionIndex + 1;
    state.startedAt = Date.now();
    state.deadline = currentQuestion.type === 'buzzer' ? null : Date.now() + state.durationMs;
    broadcastState();
    render();
    if (currentQuestion.type !== 'buzzer') timer = setTimeout(revealCurrent, state.durationMs + 250);
  }

  function scoreNumeric(question) {
    const entries = [...answers.entries()]
      .map(([id, answer]) => ({ id, value: Number(answer.value), distance: Math.abs(Number(answer.value) - Number(question.answer)) }))
      .filter((entry) => Number.isFinite(entry.value))
      .sort((a, b) => a.distance - b.distance);
    const awards = [1000, 700, 400];
    const results = {};
    entries.forEach((entry, index) => {
      const points = awards[index] || 0;
      const player = players.get(entry.id);
      if (player) player.score = (player.score || 0) + points;
      results[entry.id] = { correct: entry.distance === 0, points, distance: entry.distance };
    });
    for (const id of players.keys()) if (!results[id]) results[id] = { correct: false, points: 0 };
    return results;
  }

  function revealCurrent() {
    if (state.phase !== 'question' || !currentQuestion) return;
    clearTimeout(timer);
    if (currentQuestion.type === 'buzzer') return;

    if (currentQuestion.type === 'numeric') {
      state.lastResults = scoreNumeric(currentQuestion);
    } else {
      const results = {};
      for (const [id, answer] of answers) results[id] = { correct: Boolean(answer.correct), points: Number(answer.points) || 0 };
      for (const id of players.keys()) if (!results[id]) results[id] = { correct: false, points: 0 };
      state.lastResults = results;
    }

    state.phase = 'reveal';
    state.deadline = null;
    state.celebrate = Object.values(state.lastResults).some((result) => result.points > 0);
    if (currentQuestion.type === 'mcq') {
      state.correctIndex = currentQuestion.answer;
      state.correctLabel = currentQuestion.options[currentQuestion.answer];
    } else if (currentQuestion.type === 'truefalse') {
      state.correctIndex = currentQuestion.answer ? 0 : 1;
      state.correctLabel = currentQuestion.answer ? 'Vrai' : 'Faux';
    } else {
      state.correctLabel = `${currentQuestion.answer}${currentQuestion.unit ? ` ${currentQuestion.unit}` : ''}`;
    }
    broadcastState();
    render();
  }

  function resolveBuzz(correct) {
    if (!currentQuestion || currentQuestion.type !== 'buzzer' || !state.buzzedPlayerId) return;
    const id = state.buzzedPlayerId;
    const player = players.get(id);
    if (correct) {
      if (player) player.score = (player.score || 0) + 1000;
      state.lastResults = { [id]: { correct: true, points: 1000 } };
      state.phase = 'reveal';
      state.correctLabel = currentQuestion.answerText;
      state.celebrate = true;
    } else {
      state.lastResults = { [id]: { correct: false, points: 0 } };
      state.buzzedPlayer = null;
      state.buzzedPlayerId = null;
    }
    broadcastState();
    render();
  }

  function showLeaderboard() {
    state.phase = 'leaderboard';
    state.ranking = ranking();
    broadcastState();
    render();
  }

  function finishGame() {
    clearTimeout(timer);
    currentQuestion = null;
    state.phase = 'finished';
    state.ranking = ranking();
    state.question = null;
    state.joinQrVisible = false;
    broadcastState();
    render();
  }

  function resetGame() {
    clearTimeout(timer);
    selectedQuestions = [];
    currentQuestion = null;
    answers.clear();
    for (const player of players.values()) player.score = 0;
    state = {
      ...state,
      phase: 'lobby',
      questionIndex: -1,
      totalQuestions: 0,
      question: null,
      answerCount: 0,
      deadline: null,
      buzzedPlayer: null,
      buzzedPlayerId: null,
      lastResults: {},
      joinQrVisible: false,
    };
    broadcastState();
    render();
  }

  function renderMetrics() {
    document.getElementById('metricPlayers').textContent = players.size;
    document.getElementById('metricAnswers').textContent = state.answerCount || 0;
    document.getElementById('metricQuestion').textContent = state.totalQuestions ? `${Math.max(0, state.questionIndex + 1)}/${state.totalQuestions}` : '—';
  }

  function renderPlayers() {
    document.getElementById('playersPanel').innerHTML = players.size
      ? [...players.values()]
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .map((player) => `<div class="player-chip"><strong>${G.escapeHtml(player.name)}</strong><span>${state.mode === 'teams' ? `Équipe ${G.escapeHtml(player.team)} · ` : ''}${player.score || 0} pts</span></div>`)
        .join('')
      : '<div class="muted">Aucun joueur pour le moment.</div>';
  }

  function render() {
    renderMetrics();
    renderPlayers();
    updateJoinQrButton();

    if (state.phase === 'lobby') {
      hostStage.innerHTML = '<div class="muted">La partie est en attente. Les joueurs peuvent déjà rejoindre la salle.</div>';
      return;
    }

    if (state.phase === 'question') {
      let special = '';
      if (currentQuestion.type === 'buzzer') {
        special = state.buzzedPlayer
          ? `<div class="feedback"><strong>🚨 ${G.escapeHtml(state.buzzedPlayer)} a buzzé</strong><div class="actions" style="justify-content:center;margin-top:12px"><button id="buzzGood" class="btn green">✅ Bonne réponse</button><button id="buzzBad" class="btn danger">❌ Mauvaise réponse · Rouvrir</button></div></div>`
          : '<div class="muted">En attente du premier buzz…</div>';
      }
      hostStage.innerHTML = `<span class="badge">Question ${state.questionNumber}/${state.totalQuestions}</span><span class="badge">${G.escapeHtml(currentQuestion.difficulty)}</span><div class="host-question">${G.escapeHtml(currentQuestion.question)}</div><div class="muted">${G.escapeHtml(currentQuestion.category)} · ${G.escapeHtml(currentQuestion.type)}</div>${special}<div class="answer-log" style="margin-top:14px">${[...answers.entries()].map(([id, answer]) => `<div class="answer-log-row"><span>${G.escapeHtml(players.get(id)?.name || 'Joueur')}</span><strong>Réponse reçue${answer.points !== undefined ? ` · ${answer.points} pts` : ''}</strong></div>`).join('')}</div><div class="actions" style="margin-top:16px">${currentQuestion.type !== 'buzzer' ? '<button id="revealBtn" class="btn primary">👁️ Afficher la réponse</button>' : ''}<button id="rankBtn" class="btn">🏆 Classement</button></div>`;
      document.getElementById('revealBtn')?.addEventListener('click', revealCurrent);
      document.getElementById('rankBtn')?.addEventListener('click', showLeaderboard);
      document.getElementById('buzzGood')?.addEventListener('click', () => resolveBuzz(true));
      document.getElementById('buzzBad')?.addEventListener('click', () => resolveBuzz(false));
      return;
    }

    if (state.phase === 'reveal') {
      hostStage.innerHTML = `<span class="badge">Réponse</span><div class="host-question">✅ ${G.escapeHtml(state.correctLabel || '')}</div><div class="muted">${G.escapeHtml(currentQuestion?.explanation || '')}</div><div class="actions" style="margin-top:16px"><button id="nextBtn" class="btn green">Question suivante ➜</button><button id="rankBtn" class="btn">🏆 Afficher le classement</button></div>`;
    } else if (state.phase === 'leaderboard') {
      hostStage.innerHTML = '<div class="host-question">🏆 Classement affiché sur la TV</div><div class="actions"><button id="nextBtn" class="btn green">Continuer ➜</button></div>';
    } else if (state.phase === 'finished') {
      hostStage.innerHTML = '<div class="host-question">🏆 Partie terminée</div><div class="actions"><button id="resetInline" class="btn primary">Nouvelle partie</button></div>';
    }

    document.getElementById('nextBtn')?.addEventListener('click', nextQuestion);
    document.getElementById('rankBtn')?.addEventListener('click', showLeaderboard);
    document.getElementById('resetInline')?.addEventListener('click', resetGame);
  }

  document.getElementById('modeSelect').addEventListener('change', () => {
    state.mode = document.getElementById('modeSelect').value;
    broadcastState();
    render();
  });
  questionSourceSelect.addEventListener('change', () => {
    setGenerationStatus(questionSourceSelect.value === 'ai'
      ? 'L’IA créera une nouvelle série selon tes réglages.'
      : 'La petite banque locale sera utilisée sans génération IA.');
  });
  startBtn.addEventListener('click', startGame);
  document.getElementById('resetBtn').addEventListener('click', resetGame);
  joinQrBtn?.addEventListener('click', () => {
    state.joinQrVisible = !state.joinQrVisible;
    broadcastState();
    render();
  });

  connect();
  render();
})();
