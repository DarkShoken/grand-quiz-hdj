(() => {
  const G = window.GrandQuiz;
  if (!G?.createTransport) return;

  const META_KEY = 'grand-quiz-special-meta-v2';
  const acceptedMap = window.GRAND_QUIZ_ACCEPTED_ANSWERS || (window.GRAND_QUIZ_ACCEPTED_ANSWERS = new Map());
  const meta = new Map();
  const correctedNumeric = new Set();
  let playersMap = null;
  let answersMap = null;
  let capturedMaps = 0;
  let latestState = null;
  let patchQueued = false;

  function loadMeta() {
    try {
      const saved = JSON.parse(localStorage.getItem(META_KEY) || '[]');
      if (!Array.isArray(saved)) return;
      for (const [id, value] of saved) if (id && value) meta.set(id, value);
    } catch {}
  }

  function saveMeta() {
    try { localStorage.setItem(META_KEY, JSON.stringify([...meta.entries()].slice(-180))); }
    catch {}
  }

  loadMeta();

  function answerTextFrom(q) {
    if (q?.answerText != null) return String(q.answerText).trim();
    if (typeof q?.answer === 'string') return q.answer.trim();
    if (q?.answer && typeof q.answer === 'object') return String(q.answer.text ?? q.answer.value ?? '').trim();
    return '';
  }

  function normalizeRuntimeQuestion(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    const q = { ...raw };
    const original = String(q.originalType || q.type || 'mcq').toLowerCase();
    q.originalType = original;

    if (original === 'intruder' && q.type !== 'mcq') {
      q.type = 'mcq';
      const options = Array.isArray(q.options) ? q.options : [];
      if (!Number.isInteger(Number(q.answer))) {
        const text = answerTextFrom(q);
        q.answer = options.findIndex((option) => String(option).trim().toLowerCase() === text.toLowerCase());
      } else q.answer = Number(q.answer);
    }

    if (original === 'truefalse') {
      q.type = 'truefalse';
      if (typeof q.answer !== 'boolean') {
        const value = String(q.answer?.value ?? q.answer?.text ?? q.answer ?? '').toLowerCase();
        q.answer = value === 'true' || value === 'vrai' || value === '1';
      }
    }

    if (original === 'numeric' || original === 'estimation') {
      const rawAnswer = q.answer;
      q.type = 'numeric';
      const value = Number(rawAnswer?.value ?? rawAnswer?.text ?? rawAnswer);
      if (Number.isFinite(value)) q.answer = value;
      q.unit = q.unit || rawAnswer?.unit || '';
    }

    if (original === 'progressive') {
      q.type = 'buzzer';
      q.answerText = q.answerText || answerTextFrom(q);
      q.format = q.format || 'clues';
      q.clues = Array.isArray(q.clues) ? q.clues : [];
    } else if (original === 'buzzer') {
      q.type = 'buzzer';
      q.answerText = q.answerText || answerTextFrom(q);
    }

    if (original === 'image_mystery' || original === 'location') {
      q.type = 'free';
      q.answerText = q.answerText || answerTextFrom(q);
      q.format = q.format || 'image';
      q.media = q.media || {};
    } else if (original === 'free') {
      q.type = 'free';
      q.answerText = q.answerText || answerTextFrom(q);
    }

    return q;
  }

  function rememberQuestion(q) {
    if (!q?.id) return q;
    const normalized = normalizeRuntimeQuestion(q);
    const accepted = [
      normalized.answerText,
      ...(Array.isArray(normalized.acceptedAnswers) ? normalized.acceptedAnswers : []),
      ...(Array.isArray(normalized.accepted_answers) ? normalized.accepted_answers : []),
    ].filter(Boolean);
    if (accepted.length) acceptedMap.set(normalized.id, [...new Set(accepted.map(String))]);

    meta.set(normalized.id, {
      originalType: normalized.originalType || normalized.type,
      format: normalized.format || '',
      media: normalized.media || null,
      clues: Array.isArray(normalized.clues) ? normalized.clues : [],
      answer: normalized.type === 'numeric' && Number.isFinite(Number(normalized.answer)) ? Number(normalized.answer) : null,
      unit: normalized.unit || '',
    });
    return normalized;
  }

  function jsonResponse(data, source) {
    const headers = new Headers(source.headers || {});
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    return new Response(JSON.stringify(data), {
      status: source.status,
      statusText: source.statusText,
      headers,
    });
  }

  const previousFetch = window.fetch.bind(window);
  window.fetch = async function specialFormatsFetch(input, init = {}) {
    const response = await previousFetch(input, init);
    const url = typeof input === 'string' ? input : (input?.url || '');
    if (!/\/api\/generate-questions(?:\?|$)/.test(url) || !response.ok) return response;
    try {
      const data = await response.clone().json();
      if (!Array.isArray(data.questions)) return response;
      const questions = data.questions.map(rememberQuestion);
      saveMeta();
      return jsonResponse({ ...data, questions }, response);
    } catch {
      return response;
    }
  };

  // host-scoring-engine a déjà remplacé Map à ce stade. On s'empile dessus pour
  // récupérer les mêmes cartes joueurs/réponses sans toucher au cœur du jeu.
  const ParentMap = window.Map;
  class SpecialCapturedMap extends ParentMap {
    constructor(iterable) {
      super(iterable);
      capturedMaps += 1;
      if (capturedMaps === 1) playersMap = this;
      if (capturedMaps === 2) answersMap = this;
    }
  }
  window.Map = SpecialCapturedMap;

  function questionMeta(question) {
    if (!question?.id) return null;
    return meta.get(question.id) || {
      originalType: question.originalType || question.type,
      format: question.format || '',
      media: question.media || null,
      clues: question.clues || [],
      answer: null,
      unit: question.unit || '',
    };
  }

  function enrichPublicQuestion(payload) {
    const q = payload?.question;
    if (!q?.id) return;
    const m = questionMeta(q);
    if (!m) return;
    q.originalType = m.originalType || q.type;
    if (m.format) q.format = m.format;
    if (m.media) q.media = m.media;
    if (Array.isArray(m.clues) && m.clues.length) q.clues = m.clues;
  }

  function subtractNativeNumericAwards(payload) {
    if (!playersMap) return;
    for (const [id, result] of Object.entries(payload.lastResults || {})) {
      const player = playersMap.get(id);
      if (player) player.score = Math.max(0, (Number(player.score) || 0) - (Number(result?.points) || 0));
    }
  }

  function speedPoints(answer, payload) {
    let points = 1000;
    if (payload.speedBonus) {
      const duration = Math.max(1, Number(payload.durationMs) || 20000);
      const elapsed = Math.max(0, Number(answer?.elapsed) || duration);
      points += Math.max(0, Math.round(500 * (1 - Math.min(1, elapsed / duration))));
    }
    return points;
  }

  function applyNumericScoring(payload) {
    const q = payload?.question;
    if (!q?.id || q.type !== 'numeric' || payload.phase !== 'reveal') return;
    if (correctedNumeric.has(q.id) || !playersMap || !answersMap) return;
    const m = questionMeta(q);
    const originalType = String(m?.originalType || 'numeric');
    if (!['numeric', 'estimation'].includes(originalType)) return;
    const expected = Number(m?.answer);
    if (!Number.isFinite(expected)) return;

    correctedNumeric.add(q.id);
    subtractNativeNumericAwards(payload);

    const results = {};
    for (const id of playersMap.keys()) results[id] = { correct: false, points: 0 };
    const entries = [...answersMap.entries()].map(([id, answer]) => ({
      id,
      answer,
      value: Number(answer?.value),
      distance: Math.abs(Number(answer?.value) - expected),
    })).filter((entry) => Number.isFinite(entry.value));

    if (originalType === 'estimation') {
      entries.sort((a, b) => a.distance - b.distance || (Number(a.answer?.answeredAt) || 0) - (Number(b.answer?.answeredAt) || 0));
      const distances = [];
      for (const entry of entries) {
        if (!distances.some((value) => Math.abs(value - entry.distance) < 1e-9)) distances.push(entry.distance);
      }
      const awards = [1000, 700, 400];
      for (const entry of entries) {
        const group = distances.findIndex((value) => Math.abs(value - entry.distance) < 1e-9);
        const points = awards[group] || 0;
        const correct = entry.distance < 1e-9;
        const player = playersMap.get(entry.id);
        if (player) player.score = (Number(player.score) || 0) + points;
        if (entry.answer && typeof entry.answer === 'object') {
          entry.answer.correct = correct;
          entry.answer.points = points;
          entry.answer.scoredQuestionId = q.id;
        }
        results[entry.id] = { correct, points, distance: entry.distance };
      }
    } else {
      for (const entry of entries) {
        const correct = entry.distance < 1e-9;
        const points = correct ? speedPoints(entry.answer, payload) : 0;
        const player = playersMap.get(entry.id);
        if (player) player.score = (Number(player.score) || 0) + points;
        if (entry.answer && typeof entry.answer === 'object') {
          entry.answer.correct = correct;
          entry.answer.points = points;
          entry.answer.scoredQuestionId = q.id;
        }
        results[entry.id] = { correct, points, distance: entry.distance };
      }
    }

    payload.lastResults = results;
    payload.celebrate = Object.values(results).some((result) => Number(result.points) > 0);
    payload.correctLabel = `${String(expected).replace('.', ',')}${m?.unit ? ` ${m.unit}` : ''}`;
  }

  function formatLabel(question) {
    const m = questionMeta(question) || {};
    const original = String(m.originalType || question?.originalType || question?.type || '');
    return ({
      intruder: '🕵️ TROUVEZ L’INTRUS',
      truefalse: '⚖️ VRAI OU FAUX',
      numeric: '🔢 RÉPONSE EXACTE',
      estimation: '🎯 ESTIMATION — AU PLUS PRÈS',
      free: '✍️ RÉPONSE LIBRE',
      buzzer: '🚨 BUZZER',
      progressive: '🧩 INDICES PROGRESSIFS',
      image_mystery: '🖼️ IMAGE MYSTÈRE',
      location: '📍 OÙ SOMMES-NOUS ?',
    })[original] || '';
  }

  function queuePatch() {
    if (patchQueued) return;
    patchQueued = true;
    requestAnimationFrame(patchHost);
  }

  function patchHost() {
    patchQueued = false;
    if (latestState?.phase !== 'question' || !latestState.question) return;
    const stage = document.getElementById('hostStage');
    if (!stage || stage.querySelector('.special-host-badge, .multimedia-host-badge')) return;
    const label = formatLabel(latestState.question);
    if (!label) return;
    const badge = document.createElement('div');
    badge.className = 'special-host-badge';
    badge.textContent = label;
    stage.prepend(badge);
  }

  const originalCreateTransport = G.createTransport.bind(G);
  G.createTransport = function specialFormatsHostTransport(options = {}) {
    const transport = originalCreateTransport(options);
    if (options.role !== 'host') return transport;
    const originalSend = transport.send.bind(transport);
    transport.send = (type, payload = {}) => {
      if (type === 'state' && payload && typeof payload === 'object') {
        enrichPublicQuestion(payload);
        applyNumericScoring(payload);
        latestState = payload;
        queuePatch();
      }
      return originalSend(type, payload);
    };
    return transport;
  };

  function relabelSetting() {
    const select = document.getElementById('specialFormatSelect');
    if (!select) return false;
    const label = select.closest('.field')?.querySelector('label');
    if (label) label.textContent = 'Variété des questions';
    const texts = {
      auto: 'Varié · ~25 % de formats spéciaux',
      many: 'Très varié · ~40 % de formats spéciaux',
      off: 'Classique · priorité aux QCM',
    };
    [...select.options].forEach((option) => { if (texts[option.value]) option.textContent = texts[option.value]; });
    return true;
  }

  const style = document.createElement('style');
  style.textContent = '.special-host-badge{display:inline-block;margin-bottom:10px;padding:8px 12px;border-radius:999px;background:rgba(126,87,194,.16);border:1px solid rgba(179,136,255,.4);font-weight:900;letter-spacing:.04em}';
  document.head.appendChild(style);
  new MutationObserver(() => { relabelSetting(); queuePatch(); }).observe(document.documentElement, { childList: true, subtree: true });
  relabelSetting();
})();