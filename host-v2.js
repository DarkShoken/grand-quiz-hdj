(() => {
  const G = window.GrandQuiz;
  const BANK = window.GRAND_QUIZ_QUESTIONS || [];
  const EXTRA_CATEGORIES = window.GRAND_QUIZ_CATEGORIES || [];
  const USED_KEY = 'grand-quiz-used-questions-v2';
  const AUTO_NEXT_MS = 15000;
  const OFFLINE_AFTER_MS = 15000;
  const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

  let room = G.cleanRoom(G.qs('room', 'QUIZ'));
  let transport = null;
  let questionTimer = null;
  let revealTimer = null;
  let clockTimer = null;
  let presenceTimer = null;
  let selectedQuestions = [];
  let currentQuestion = null;
  let generating = false;
  let restoreCandidate = null;

  const players = new Map();
  const answers = new Map();

  const roomInput = document.getElementById('roomInput');
  const connection = document.getElementById('connection');
  const hostStage = document.getElementById('hostStage');
  const joinQrBtn = document.getElementById('joinQrBtn');
  const startBtn = document.getElementById('startBtn');
  const generationStatus = document.getElementById('generationStatus');
  const questionSourceSelect = document.getElementById('questionSourceSelect');
  const categoriesBox = document.getElementById('categories');

  const initialState = () => ({
    phase: 'lobby', mode: 'individual', difficulty: 'Mixte', questionIndex: -1,
    questionNumber: 0, totalQuestions: 0, question: null, answerCount: 0,
    durationMs: 20000, deadline: null, revealDeadline: null, startedAt: null,
    buzzedPlayer: null, buzzedPlayerId: null, ranking: [], lastResults: {},
    correctLabel: null, correctIndex: null, celebrate: false, speedBonus: false,
    joinQrVisible: false, updatedAt: Date.now(),
  });
  let state = initialState();

  const sessionKey = () => `grand-quiz-session-v2:${room}`;
  const authKey = () => `grand-quiz-host-auth:${room}`;

  function clearTimers() {
    clearTimeout(questionTimer); clearTimeout(revealTimer); clearInterval(clockTimer);
    questionTimer = null; revealTimer = null; clockTimer = null;
  }

  function normalizeText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function loadUsedQuestions() {
    try {
      const value = JSON.parse(localStorage.getItem(USED_KEY) || '[]');
      return Array.isArray(value) ? value.filter(Boolean).slice(-300) : [];
    } catch { return []; }
  }

  function rememberQuestions(questions) {
    const seen = new Set();
    const merged = [...loadUsedQuestions(), ...questions.map((q) => q.question)]
      .filter((text) => {
        const key = normalizeText(text);
        if (!key || seen.has(key)) return false;
        seen.add(key); return true;
      }).slice(-300);
    localStorage.setItem(USED_KEY, JSON.stringify(merged));
  }

  function saveSession() {
    if (state.phase === 'lobby' && !selectedQuestions.length && !players.size) return;
    try {
      localStorage.setItem(sessionKey(), JSON.stringify({
        version: 2, savedAt: Date.now(), state, selectedQuestions,
        players: [...players.values()], answers: [...answers.entries()],
      }));
    } catch (error) { console.error('Sauvegarde impossible', error); }
  }

  function loadSession() {
    try {
      const saved = JSON.parse(localStorage.getItem(sessionKey()) || 'null');
      if (!saved || saved.version !== 2 || !saved.savedAt) return null;
      if (Date.now() - saved.savedAt > SESSION_MAX_AGE_MS) {
        localStorage.removeItem(sessionKey()); return null;
      }
      return saved;
    } catch { return null; }
  }

  function setGenerationStatus(text, kind = '') {
    generationStatus.textContent = text;
    generationStatus.style.color = kind === 'error' ? '#ff9cb1' : kind === 'ok' ? '#7bf8d3' : '';
  }

  function setGenerating(value) {
    generating = value;
    startBtn.disabled = value;
    startBtn.textContent = value ? '✨ Création des questions…' : '✨ Générer et prévisualiser';
  }

  async function verifyPin(pin) {
    const response = await fetch('/api/verify-host-pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || 'Code PIN incorrect.');
  }

  function showPinGate() {
    const overlay = document.createElement('div');
    overlay.className = 'host-pin-overlay';
    overlay.innerHTML = `<form id="pinForm" class="host-pin-card"><div class="host-pin-icon">🔐</div><h2>Accès soignant</h2><p>Entre le code PIN à 4 chiffres.</p><input id="pinInput" inputmode="numeric" maxlength="4" autocomplete="one-time-code" placeholder="••••"><button id="pinSubmit" class="btn primary big" type="submit">Ouvrir la console</button><div id="pinError" class="host-pin-error"></div></form>`;
    document.body.appendChild(overlay);
    const form = document.getElementById('pinForm');
    const input = document.getElementById('pinInput');
    const submit = document.getElementById('pinSubmit');
    const errorBox = document.getElementById('pinError');
    input.focus();
    input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 4); });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (input.value.length !== 4) { errorBox.textContent = 'Entre exactement 4 chiffres.'; return; }
      submit.disabled = true; errorBox.textContent = '';
      try {
        await verifyPin(input.value);
        sessionStorage.setItem(authKey(), 'ok');
        overlay.remove(); init();
      } catch (error) { errorBox.textContent = error.message; input.select(); }
      finally { submit.disabled = false; }
    });
  }

  function populateCategories() {
    const categories = [...new Set([...EXTRA_CATEGORIES, ...BANK.map((q) => q.category)])]
      .sort((a, b) => a.localeCompare(b, 'fr'));
    categoriesBox.innerHTML = categories.map((category) =>
      `<label class="check"><input type="checkbox" value="${G.escapeHtml(category)}"><span>${G.escapeHtml(category)}</span></label>`
    ).join('');
    const actions = document.createElement('div');
    actions.className = 'category-quick-actions';
    actions.innerHTML = '<button id="checkAll" class="btn" type="button">Tout cocher</button><button id="uncheckAll" class="btn" type="button">Tout décocher</button>';
    categoriesBox.before(actions);
    document.getElementById('checkAll').addEventListener('click', () => categoriesBox.querySelectorAll('input').forEach((i) => { i.checked = true; }));
    document.getElementById('uncheckAll').addEventListener('click', () => categoriesBox.querySelectorAll('input').forEach((i) => { i.checked = false; }));
  }

  function connect() {
    transport?.close();
    transport = G.createTransport({ room, role: 'host', onMessage: handleMessage,
      onStatus: ({ ready, mode }) => {
        connection.textContent = ready ? (mode === 'online' ? '🟢 En ligne' : '🟡 Démo locale') : 'Connexion…';
        connection.className = `badge ${ready ? 'ok' : 'warn'}`;
        if (ready) broadcastState(false);
      },
    });
    document.getElementById('screenLink').href = new URL(`index.html?room=${room}`, location.href).href;
    document.getElementById('playerLink').href = G.makePlayUrl(room);
  }

  function selectedCategories() {
    return [...categoriesBox.querySelectorAll('input:checked')].map((input) => input.value);
  }

  function upsertPlayer(payload) {
    if (!payload?.playerId) return null;
    const existing = players.get(payload.playerId);
    const player = {
      id: payload.playerId,
      name: String(payload.name || existing?.name || 'Joueur').slice(0, 24),
      team: payload.team === 'Bleue' ? 'Bleue' : (existing?.team || 'Orange'),
      score: Number(existing?.score) || 0,
      online: true,
      lastSeen: Date.now(),
    };
    players.set(player.id, player);
    return player;
  }

  function publicPlayers() {
    return [...players.values()].map(({ id, name, team, score, online }) => ({ id, name, team, score, online }));
  }

  function ranking() {
    if (state.mode === 'teams') {
      const totals = { Orange: 0, Bleue: 0 };
      for (const player of players.values()) totals[player.team === 'Bleue' ? 'Bleue' : 'Orange'] += player.score || 0;
      return Object.entries(totals).map(([name, score]) => ({ name: `Équipe ${name}`, score })).sort((a, b) => b.score - a.score);
    }
    return [...players.values()].map((p) => ({ id: p.id, name: p.name, score: p.score || 0 })).sort((a, b) => b.score - a.score);
  }

  function sanitizeQuestion(question) {
    if (!question) return null;
    const clean = { id: question.id, category: question.category, difficulty: question.difficulty,
      type: question.type, question: question.question, explanation: question.explanation || '' };
    if (question.type === 'mcq') clean.options = question.options;
    if (question.type === 'truefalse') clean.options = ['Vrai', 'Faux'];
    if (question.type === 'numeric') clean.unit = question.unit || '';
    return clean;
  }

  function snapshot() {
    const copy = { ...state, room, players: publicPlayers(), ranking: ranking(),
      answeredPlayerIds: [...answers.keys()], updatedAt: Date.now() };
    if (state.phase === 'preview') {
      copy.phase = 'lobby'; copy.question = null; copy.questionIndex = -1;
      copy.questionNumber = 0; copy.answerCount = 0; copy.deadline = null; copy.revealDeadline = null;
    }
    return copy;
  }

  function broadcastState(shouldSave = true) {
    state.updatedAt = Date.now();
    transport?.send('state', snapshot());
    renderMetrics(); updateJoinQrButton();
    if (shouldSave) saveSession();
  }

  function updateJoinQrButton() {
    joinQrBtn.textContent = state.joinQrVisible ? '✕ Masquer le QR joueurs sur la TV' : '📱 Afficher le QR joueurs sur la TV';
    joinQrBtn.classList.toggle('danger', Boolean(state.joinQrVisible));
    joinQrBtn.classList.toggle('primary', !state.joinQrVisible);
  }

  function expectedAnswer(question) {
    if (!question) return '—';
    if (question.type === 'mcq') return question.options?.[Number(question.answer)] ?? '—';
    if (question.type === 'truefalse') return question.answer ? 'Vrai' : 'Faux';
    if (question.type === 'numeric') return `${question.answer}${question.unit ? ` ${question.unit}` : ''}`;
    return question.answerText || String(question.answer || '—');
  }

  function submittedAnswer(question, answer) {
    if (question.type === 'mcq') return question.options?.[Number(answer.value)] ?? String(answer.value ?? '—');
    if (question.type === 'truefalse') return String(answer.value) === 'true' ? 'Vrai' : 'Faux';
    if (question.type === 'numeric') return `${String(answer.value ?? '').replace('.', ',')}${question.unit ? ` ${question.unit}` : ''}`;
    return String(answer.value ?? '—');
  }

  function standardResult(question, answer) {
    const correct = question.type === 'mcq'
      ? Number(answer.value) === Number(question.answer)
      : String(answer.value) === String(question.answer);
    let points = correct ? 1000 : 0;
    if (correct && state.speedBonus) points += Math.max(0, Math.round(500 * (1 - Math.min(1, answer.elapsed / state.durationMs))));
    return { correct, points };
  }

  function handleMessage(message) {
    const payload = message.payload || {};
    if (message.type === 'state_request') { broadcastState(false); return; }
    if (message.type === 'join_qr_set') {
      state.joinQrVisible = Boolean(payload.visible); broadcastState(); render(); return;
    }
    if (message.type === 'join') { upsertPlayer(payload); broadcastState(); render(); return; }
    if (message.type === 'heartbeat') {
      const player = players.get(payload.playerId);
      if (player) {
        const changed = !player.online;
        player.online = true; player.lastSeen = Date.now();
        if (changed) { broadcastState(); render(); }
      } else if (payload.playerId && payload.name) {
        upsertPlayer(payload); broadcastState(); render();
      }
      return;
    }
    if (message.type === 'leave') {
      const player = players.get(payload.playerId);
      if (player) { player.online = false; player.lastSeen = Date.now(); broadcastState(); render(); }
      return;
    }
    if (message.type === 'answer' && state.phase === 'question' && currentQuestion?.type !== 'buzzer') {
      if (!payload.playerId || payload.questionId !== currentQuestion?.id) {
        transport?.send('answer_ack', { playerId: payload.playerId, questionId: payload.questionId, accepted: false }); return;
      }
      const player = upsertPlayer(payload);
      if (!player || answers.has(payload.playerId)) {
        transport?.send('answer_ack', { playerId: payload.playerId, questionId: payload.questionId, accepted: true }); return;
      }
      const answer = { value: payload.value, answeredAt: Date.now(), elapsed: Math.max(0, Date.now() - (state.startedAt || Date.now())) };
      if (currentQuestion.type === 'mcq' || currentQuestion.type === 'truefalse') {
        const result = standardResult(currentQuestion, answer);
        answer.correct = result.correct; answer.points = result.points; player.score += result.points;
      }
      answers.set(payload.playerId, answer); state.answerCount = answers.size;
      transport?.send('answer_ack', { playerId: payload.playerId, questionId: payload.questionId, accepted: true });
      broadcastState(); render(); return;
    }
    if (message.type === 'buzz' && state.phase === 'question' && currentQuestion?.type === 'buzzer' && !state.buzzedPlayerId) {
      const player = upsertPlayer(payload); if (!player) return;
      state.buzzedPlayerId = player.id; state.buzzedPlayer = player.name; broadcastState(); render();
    }
  }

  function localQuestions(categories, difficulty, count, excluded = []) {
    const blocked = new Set(excluded.map(normalizeText));
    const exact = BANK.filter((q) => categories.includes(q.category) && (difficulty === 'Mixte' || q.difficulty === difficulty) && !blocked.has(normalizeText(q.question)));
    const recycled = BANK.filter((q) => categories.includes(q.category) && (difficulty === 'Mixte' || q.difficulty === difficulty) && !exact.includes(q));
    return [...G.shuffle(exact), ...G.shuffle(recycled)].slice(0, count);
  }

  async function generateQuestions(categories, difficulty, count, extraExcluded = []) {
    const response = await fetch('/api/generate-questions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories, difficulty, count,
        exclude: [...loadUsedQuestions().slice(-80), ...extraExcluded].slice(-120) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'La génération IA a échoué.');
    if (!Array.isArray(data.questions) || !data.questions.length) throw new Error('Aucune question générée.');
    return data.questions;
  }

  async function prepareGame() {
    if (generating) return;
    const categories = selectedCategories();
    if (!categories.length) { alert('Sélectionne au moins une catégorie.'); return; }
    const count = Number(document.getElementById('countSelect').value) || 15;
    const difficulty = document.getElementById('difficultySelect').value || 'Mixte';
    const source = questionSourceSelect.value;
    state.mode = document.getElementById('modeSelect').value;
    state.difficulty = difficulty;
    state.durationMs = Number(document.getElementById('durationSelect').value) || 20000;
    state.speedBonus = document.getElementById('speedSelect').value === 'on';
    state.joinQrVisible = false;
    setGenerating(true);
    try {
      let questions = [];
      if (source === 'ai') {
        setGenerationStatus(`Gemini prépare ${count} questions courtes…`);
        try {
          questions = await generateQuestions(categories, difficulty, count);
          const missing = count - questions.length;
          if (missing > 0) questions.push(...localQuestions(categories, difficulty, missing, questions.map((q) => q.question)));
          setGenerationStatus(`${questions.length} questions prêtes à vérifier.`, 'ok');
        } catch (error) {
          questions = localQuestions(categories, difficulty, count, loadUsedQuestions());
          setGenerationStatus(`IA indisponible : ${error.message} Banque locale utilisée.`, 'error');
        }
      } else {
        questions = localQuestions(categories, difficulty, count, loadUsedQuestions());
        setGenerationStatus(`${questions.length} questions locales prêtes à vérifier.`, 'ok');
      }
      if (!questions.length) { alert('Aucune question disponible.'); return; }
      selectedQuestions = questions.slice(0, count);
      state.phase = 'preview'; state.totalQuestions = selectedQuestions.length; state.questionIndex = -1;
      state.question = null; state.lastResults = {}; state.ranking = [];
      saveSession(); render(); broadcastState(false);
    } finally { setGenerating(false); }
  }

  async function replaceQuestion(index) {
    const old = selectedQuestions[index]; if (!old || generating) return;
    setGenerating(true); setGenerationStatus(`Remplacement de la question ${index + 1}…`);
    try {
      let replacement;
      try {
        replacement = (await generateQuestions([old.category], old.difficulty, 1, selectedQuestions.map((q) => q.question)))[0];
      } catch {
        replacement = localQuestions([old.category], old.difficulty, 1, selectedQuestions.map((q) => q.question))[0];
      }
      if (!replacement) throw new Error('Aucune question de remplacement disponible.');
      selectedQuestions[index] = replacement; saveSession(); setGenerationStatus('Question remplacée.', 'ok'); renderPreview();
    } catch (error) { setGenerationStatus(error.message, 'error'); }
    finally { setGenerating(false); }
  }

  function launchGame() {
    if (!selectedQuestions.length) return;
    rememberQuestions(selectedQuestions);
    for (const player of players.values()) player.score = 0;
    state.totalQuestions = selectedQuestions.length; state.questionIndex = -1;
    state.lastResults = {}; state.ranking = []; nextQuestion();
  }

  function nextQuestion() {
    clearTimers(); answers.clear(); state.answerCount = 0; state.buzzedPlayer = null; state.buzzedPlayerId = null;
    state.lastResults = {}; state.correctLabel = null; state.correctIndex = null; state.celebrate = false;
    state.revealDeadline = null; state.questionIndex += 1;
    if (state.questionIndex >= selectedQuestions.length) { finishGame(); return; }
    currentQuestion = selectedQuestions[state.questionIndex]; state.phase = 'question'; state.question = sanitizeQuestion(currentQuestion);
    state.questionNumber = state.questionIndex + 1; state.startedAt = Date.now();
    state.deadline = currentQuestion.type === 'buzzer' ? null : Date.now() + state.durationMs;
    broadcastState(); render();
    if (currentQuestion.type !== 'buzzer') questionTimer = setTimeout(revealCurrent, state.durationMs + 250);
  }

  function scoreNumeric(question) {
    const entries = [...answers.entries()].map(([id, answer]) => ({ id, value: Number(answer.value), distance: Math.abs(Number(answer.value) - Number(question.answer)) }))
      .filter((entry) => Number.isFinite(entry.value)).sort((a, b) => a.distance - b.distance);
    const awards = [1000, 700, 400]; const results = {};
    entries.forEach((entry, index) => {
      const points = awards[index] || 0; const player = players.get(entry.id); if (player) player.score += points;
      results[entry.id] = { correct: entry.distance === 0, points, distance: entry.distance };
    });
    for (const id of players.keys()) if (!results[id]) results[id] = { correct: false, points: 0 };
    return results;
  }

  function scheduleRevealAdvance() {
    clearTimeout(revealTimer);
    if (!state.revealDeadline) return;
    revealTimer = setTimeout(() => { if (state.phase === 'reveal') nextQuestion(); }, Math.max(0, state.revealDeadline - Date.now()) + 80);
  }

  function revealCurrent() {
    if (state.phase !== 'question' || !currentQuestion || currentQuestion.type === 'buzzer') return;
    clearTimeout(questionTimer); questionTimer = null;
    if (currentQuestion.type === 'numeric') state.lastResults = scoreNumeric(currentQuestion);
    else {
      const results = {};
      for (const [id, answer] of answers) results[id] = { correct: Boolean(answer.correct), points: Number(answer.points) || 0 };
      for (const id of players.keys()) if (!results[id]) results[id] = { correct: false, points: 0 };
      state.lastResults = results;
    }
    state.phase = 'reveal'; state.deadline = null; state.revealDeadline = Date.now() + AUTO_NEXT_MS;
    state.celebrate = Object.values(state.lastResults).some((result) => result.points > 0);
    if (currentQuestion.type === 'mcq') { state.correctIndex = currentQuestion.answer; state.correctLabel = currentQuestion.options[currentQuestion.answer]; }
    else if (currentQuestion.type === 'truefalse') { state.correctIndex = currentQuestion.answer ? 0 : 1; state.correctLabel = currentQuestion.answer ? 'Vrai' : 'Faux'; }
    else state.correctLabel = `${currentQuestion.answer}${currentQuestion.unit ? ` ${currentQuestion.unit}` : ''}`;
    broadcastState(); render(); scheduleRevealAdvance();
  }

  function resolveBuzz(correct) {
    if (!currentQuestion || currentQuestion.type !== 'buzzer' || !state.buzzedPlayerId) return;
    const id = state.buzzedPlayerId; const player = players.get(id);
    if (correct) {
      if (player) player.score += 1000;
      state.lastResults = { [id]: { correct: true, points: 1000 } }; state.phase = 'reveal';
      state.correctLabel = currentQuestion.answerText; state.celebrate = true; state.revealDeadline = Date.now() + AUTO_NEXT_MS;
      broadcastState(); render(); scheduleRevealAdvance(); return;
    }
    state.lastResults = { [id]: { correct: false, points: 0 } }; state.buzzedPlayer = null; state.buzzedPlayerId = null;
    broadcastState(); render();
  }

  function showLeaderboard() {
    clearTimeout(revealTimer); revealTimer = null; state.phase = 'leaderboard'; state.revealDeadline = null;
    state.ranking = ranking(); broadcastState(); render();
  }

  function finishGame() {
    clearTimers(); currentQuestion = null; state.phase = 'finished'; state.ranking = ranking();
    state.question = null; state.deadline = null; state.revealDeadline = null; state.joinQrVisible = false;
    broadcastState(); render();
  }

  function resetGame() {
    clearTimers(); selectedQuestions = []; currentQuestion = null; answers.clear(); players.clear(); state = initialState();
    localStorage.removeItem(sessionKey()); broadcastState(false); render();
  }

  function restoreSession() {
    const saved = restoreCandidate || loadSession(); if (!saved) return;
    clearTimers(); selectedQuestions = Array.isArray(saved.selectedQuestions) ? saved.selectedQuestions : [];
    state = { ...initialState(), ...saved.state };
    players.clear(); (saved.players || []).forEach((p) => players.set(p.id, { ...p, online: false, lastSeen: 0 }));
    answers.clear(); (saved.answers || []).forEach(([id, answer]) => answers.set(id, answer));
    currentQuestion = selectedQuestions[state.questionIndex] || null; restoreCandidate = null;
    const now = Date.now();
    if (state.phase === 'question' && currentQuestion?.type !== 'buzzer') {
      if (state.deadline && state.deadline <= now) setTimeout(revealCurrent, 100);
      else questionTimer = setTimeout(revealCurrent, Math.max(0, state.deadline - now) + 100);
    }
    if (state.phase === 'reveal') {
      if (!state.revealDeadline || state.revealDeadline <= now) setTimeout(nextQuestion, 200);
      else scheduleRevealAdvance();
    }
    broadcastState(false); render();
  }

  function renderMetrics() {
    document.getElementById('metricPlayers').textContent = players.size;
    document.getElementById('metricAnswers').textContent = state.answerCount || 0;
    document.getElementById('metricQuestion').textContent = state.totalQuestions ? `${Math.max(0, state.questionIndex + 1)}/${state.totalQuestions}` : '—';
  }

  function renderPlayers() {
    document.getElementById('playersPanel').innerHTML = players.size ? [...players.values()]
      .sort((a, b) => (b.score || 0) - (a.score || 0)).map((player) =>
        `<div class="player-chip ${player.online ? '' : 'player-offline'}"><div><strong>${G.escapeHtml(player.name)}</strong><small>${player.online ? '● En ligne' : '○ Hors ligne — score conservé'}</small></div><span>${state.mode === 'teams' ? `Équipe ${G.escapeHtml(player.team)} · ` : ''}${player.score || 0} pts</span><button class="remove-player" data-id="${G.escapeHtml(player.id)}" title="Retirer définitivement">✕</button></div>`
      ).join('') : '<div class="muted">Aucun joueur pour le moment.</div>';
    document.querySelectorAll('.remove-player').forEach((button) => button.addEventListener('click', () => {
      const player = players.get(button.dataset.id);
      if (player && confirm(`Retirer définitivement ${player.name} de la partie ?`)) {
        players.delete(player.id); answers.delete(player.id); state.answerCount = answers.size; broadcastState(); render();
      }
    }));
  }

  function renderAnswerLog() {
    if (!answers.size) return '<div class="muted">Aucune réponse reçue.</div>';
    return [...answers.entries()].map(([id, answer]) => {
      const player = players.get(id); let status = '📝 Reçue';
      if (answer.correct === true) status = `✅ Bonne · ${answer.points || 0} pts`;
      if (answer.correct === false) status = '❌ Mauvaise';
      return `<div class="answer-log-row answer-log-detailed"><div><strong>${G.escapeHtml(player?.name || 'Joueur')}</strong></div><div class="answer-value"><strong>${G.escapeHtml(submittedAnswer(currentQuestion, answer))}</strong><span>${status}</span></div></div>`;
    }).join('');
  }

  function renderPreview() {
    state.phase = 'preview';
    hostStage.innerHTML = `<div class="preview-head"><div><span class="badge">Prévisualisation</span><h2>${selectedQuestions.length} questions à vérifier</h2><p class="muted">Retire ou remplace une question avant de lancer la partie.</p></div><button id="launchGame" class="btn green big">▶ Lancer la partie</button></div><div class="preview-list">${selectedQuestions.map((q, index) =>
      `<article class="preview-item"><div class="preview-meta"><span>${index + 1}</span><span>${G.escapeHtml(q.category)}</span><span>${G.escapeHtml(q.difficulty)}</span></div><div class="preview-question">${G.escapeHtml(q.question)}</div><div class="preview-answer">✅ ${G.escapeHtml(expectedAnswer(q))}</div><div class="preview-actions"><button class="btn replace-question" data-index="${index}">↻ Remplacer</button><button class="btn danger remove-question" data-index="${index}">Supprimer</button></div></article>`
    ).join('')}</div><div class="preview-bottom"><button id="launchGameBottom" class="btn green big">▶ Lancer la partie</button></div>`;
    document.getElementById('launchGame').addEventListener('click', launchGame);
    document.getElementById('launchGameBottom').addEventListener('click', launchGame);
    document.querySelectorAll('.replace-question').forEach((b) => b.addEventListener('click', () => replaceQuestion(Number(b.dataset.index))));
    document.querySelectorAll('.remove-question').forEach((b) => b.addEventListener('click', () => {
      if (selectedQuestions.length > 1) { selectedQuestions.splice(Number(b.dataset.index), 1); state.totalQuestions = selectedQuestions.length; saveSession(); renderPreview(); }
    }));
  }

  function startClock() {
    clearInterval(clockTimer);
    const update = () => {
      const node = document.getElementById('hostRevealTimer');
      if (node && state.revealDeadline) node.textContent = String(Math.ceil(Math.max(0, state.revealDeadline - Date.now()) / 1000));
    };
    update(); clockTimer = setInterval(update, 100);
  }

  function render() {
    renderMetrics(); renderPlayers(); updateJoinQrButton();
    if (state.phase === 'preview') { renderPreview(); return; }
    if (state.phase === 'lobby') {
      if (restoreCandidate) {
        const savedState = restoreCandidate.state || {};
        hostStage.innerHTML = `<div class="restore-card"><div><span class="badge">Sauvegarde trouvée</span><h2>Reprendre la partie ?</h2><p>Question ${Math.max(1, Number(savedState.questionIndex) + 1)}/${savedState.totalQuestions || '?'}, sauvegardée récemment.</p></div><div class="actions"><button id="restoreGame" class="btn green">↩ Reprendre</button><button id="discardGame" class="btn danger">Abandonner</button></div></div>`;
        document.getElementById('restoreGame').addEventListener('click', restoreSession);
        document.getElementById('discardGame').addEventListener('click', () => { localStorage.removeItem(sessionKey()); restoreCandidate = null; render(); });
      } else hostStage.innerHTML = '<div class="muted">La partie est en attente. Les joueurs peuvent déjà rejoindre la salle.</div>';
      return;
    }
    if (state.phase === 'question') {
      const typeLabel = ({ mcq: 'QCM', truefalse: 'Vrai / Faux', numeric: 'Réponse chiffrée', buzzer: 'Buzzer / oral' })[currentQuestion.type] || currentQuestion.type;
      const key = `<div class="host-answer-key"><span>🔐 Réponse attendue — console uniquement</span><strong>${G.escapeHtml(expectedAnswer(currentQuestion))}</strong></div>`;
      const buzzer = currentQuestion.type === 'buzzer' ? (state.buzzedPlayer
        ? `<div class="feedback"><strong>🚨 ${G.escapeHtml(state.buzzedPlayer)} a buzzé</strong><div class="actions center"><button id="buzzGood" class="btn green">✅ Bonne réponse</button><button id="buzzBad" class="btn danger">❌ Mauvaise · Rouvrir</button></div></div>`
        : '<div class="muted">En attente du premier buzz…</div>') : '';
      const log = currentQuestion.type === 'buzzer' ? '' : `<div class="answer-log-title">Réponses des participants</div><div class="answer-log">${renderAnswerLog()}</div>`;
      hostStage.innerHTML = `<div class="question-meta-host"><span class="badge">Question ${state.questionNumber}/${state.totalQuestions}</span><span class="badge">${G.escapeHtml(currentQuestion.difficulty)}</span></div><div class="host-question">${G.escapeHtml(currentQuestion.question)}</div><div class="muted">${G.escapeHtml(currentQuestion.category)} · ${G.escapeHtml(typeLabel)}</div>${key}${buzzer}${log}<div class="actions">${currentQuestion.type !== 'buzzer' ? '<button id="revealBtn" class="btn primary">👁 Afficher la réponse</button>' : ''}<button id="rankBtn" class="btn">🏆 Classement</button></div>`;
      document.getElementById('revealBtn')?.addEventListener('click', revealCurrent);
      document.getElementById('rankBtn').addEventListener('click', showLeaderboard);
      document.getElementById('buzzGood')?.addEventListener('click', () => resolveBuzz(true));
      document.getElementById('buzzBad')?.addEventListener('click', () => resolveBuzz(false));
      return;
    }
    if (state.phase === 'reveal') {
      hostStage.innerHTML = `<span class="badge">Réponse</span><div class="host-question">✅ ${G.escapeHtml(state.correctLabel || '')}</div><div class="muted">${G.escapeHtml(currentQuestion?.explanation || '')}</div><div class="host-auto-next"><div id="hostRevealTimer" class="host-auto-next-circle">15</div><div><strong>Question suivante automatique</strong><span>15 secondes pour commenter la réponse.</span></div></div><div class="actions"><button id="nextBtn" class="btn green">Question suivante ➜</button><button id="rankBtn" class="btn">🏆 Classement</button></div>`;
      document.getElementById('nextBtn').addEventListener('click', nextQuestion);
      document.getElementById('rankBtn').addEventListener('click', showLeaderboard);
      startClock(); return;
    }
    if (state.phase === 'leaderboard') {
      hostStage.innerHTML = '<div class="host-question">🏆 Classement affiché sur la TV</div><div class="actions"><button id="nextBtn" class="btn green">Continuer ➜</button></div>';
      document.getElementById('nextBtn').addEventListener('click', nextQuestion); return;
    }
    if (state.phase === 'finished') {
      hostStage.innerHTML = '<div class="host-question">🏆 Partie terminée</div><div class="actions"><button id="resetInline" class="btn primary">Nouvelle partie</button></div>';
      document.getElementById('resetInline').addEventListener('click', resetGame);
    }
  }

  function startPresenceMonitor() {
    clearInterval(presenceTimer);
    presenceTimer = setInterval(() => {
      let changed = false; const now = Date.now();
      for (const player of players.values()) {
        if (player.online && now - (player.lastSeen || 0) > OFFLINE_AFTER_MS) { player.online = false; changed = true; }
      }
      if (changed) { saveSession(); renderPlayers(); broadcastState(false); }
    }, 5000);
  }

  function bindControls() {
    roomInput.addEventListener('change', () => {
      room = G.cleanRoom(roomInput.value); roomInput.value = room; G.setRoomInUrl(room);
      clearTimers(); players.clear(); answers.clear(); selectedQuestions = []; currentQuestion = null; state = initialState();
      restoreCandidate = loadSession(); connect(); render();
    });
    startBtn.addEventListener('click', prepareGame);
    document.getElementById('resetBtn').addEventListener('click', () => { if (confirm('Réinitialiser entièrement la partie ?')) resetGame(); });
    document.getElementById('modeSelect').addEventListener('change', () => { state.mode = document.getElementById('modeSelect').value; broadcastState(); render(); });
    questionSourceSelect.addEventListener('change', () => setGenerationStatus(questionSourceSelect.value === 'ai' ? 'Gemini générera une série courte à prévisualiser.' : 'La banque locale sera prévisualisée avant la partie.'));
    joinQrBtn.addEventListener('click', () => { state.joinQrVisible = !state.joinQrVisible; broadcastState(); render(); });
  }

  function init() {
    roomInput.value = room; G.setRoomInUrl(room); startBtn.textContent = '✨ Générer et prévisualiser';
    populateCategories(); bindControls(); restoreCandidate = loadSession(); connect(); startPresenceMonitor(); render();
  }

  if (sessionStorage.getItem(authKey()) === 'ok') init(); else showPinGate();
})();
