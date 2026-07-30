(() => {
  const G = window.GrandQuiz;
  if (!G || typeof G.createTransport !== 'function') return;

  const ParentMap = window.Map;
  const NativeMap = globalThis.Map;
  let capturedMaps = 0;
  let playersMap = null;
  let answersMap = null;
  let activeQuestionId = null;
  let correctedQuestionId = null;
  let correctedResults = null;
  let correctedLabel = '';
  const scoreBaseline = new NativeMap();

  class ScoringCapturedMap extends ParentMap {
    constructor(iterable) {
      super(iterable);
      capturedMaps += 1;
      if (capturedMaps === 1) playersMap = this;
      if (capturedMaps === 2) answersMap = this;
    }
  }
  window.Map = ScoringCapturedMap;

  function normalizeText(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[’']/g, ' ')
      .replace(/\b(?:le|la|les|un|une|des|du|de|d|l)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    const current = new Array(b.length + 1);
    for (let i = 1; i <= a.length; i += 1) {
      current[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        current[j] = Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
      for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
    }
    return previous[b.length];
  }

  function sameDigits(a, b) {
    const digitsA = String(a ?? '').match(/\d+/g) || [];
    const digitsB = String(b ?? '').match(/\d+/g) || [];
    return digitsA.join('|') === digitsB.join('|');
  }

  function textAnswerIsCorrect(submitted, expected) {
    const a = normalizeText(submitted);
    const b = normalizeText(expected);
    if (!a || !b || !sameDigits(submitted, expected)) return false;
    if (a === b) return true;
    const distance = levenshtein(a, b);
    const allowed = b.length >= 12 ? 2 : b.length >= 5 ? 1 : 0;
    return distance <= allowed && distance / Math.max(a.length, b.length) <= 0.16;
  }

  function parseSingleNumber(value) {
    const matches = String(value ?? '').replace(/\s/g, '').match(/[-+]?\d+(?:[.,]\d+)?/g) || [];
    if (matches.length !== 1) return NaN;
    return Number(matches[0].replace(',', '.'));
  }

  function pointsFor(answer, correct, payload) {
    if (!correct) return 0;
    let points = 1000;
    if (payload.speedBonus) {
      const duration = Number(payload.durationMs) || 20000;
      const elapsed = Math.max(0, Number(answer?.elapsed) || duration);
      points += Math.max(0, Math.round(500 * (1 - Math.min(1, elapsed / duration))));
    }
    return points;
  }

  function captureBaseline(payload) {
    if (!playersMap) return;
    for (const [id, player] of playersMap.entries()) {
      if (!scoreBaseline.has(id)) scoreBaseline.set(id, Number(player?.score) || 0);
    }
    const domExpected = document.querySelector('#hostStage .host-answer-key strong')?.textContent?.trim();
    if (domExpected) correctedLabel = domExpected;
    if (payload.phase === 'question' && payload.question?.id !== activeQuestionId) {
      activeQuestionId = payload.question?.id || null;
      correctedQuestionId = null;
      correctedResults = null;
      correctedLabel = '';
      scoreBaseline.clear();
      for (const [id, player] of playersMap.entries()) scoreBaseline.set(id, Number(player?.score) || 0);
    }
  }

  function rankingFromPlayers(mode) {
    if (!playersMap) return [];
    if (mode === 'teams') {
      const totals = { Orange: 0, Bleue: 0 };
      for (const player of playersMap.values()) {
        const team = player?.team === 'Bleue' ? 'Bleue' : 'Orange';
        totals[team] += Number(player?.score) || 0;
      }
      return Object.entries(totals)
        .map(([name, score]) => ({ name: `Équipe ${name}`, score }))
        .sort((a, b) => b.score - a.score);
    }
    return [...playersMap.values()]
      .map((player) => ({ id: player.id, name: player.name, score: Number(player.score) || 0 }))
      .sort((a, b) => b.score - a.score);
  }

  function applyStrictResult(payload) {
    if (!playersMap || !answersMap || payload.phase !== 'reveal' || !payload.question?.id) return;
    const type = String(payload.question.type || '').toLowerCase();
    const isNumeric = type === 'numeric';
    const isFreeText = ['free', 'text', 'open', 'open_text', 'freeform', 'written'].includes(type);
    if (!isNumeric && !isFreeText) return;

    const questionId = payload.question.id;
    const expected = isNumeric
      ? parseSingleNumber(payload.correctLabel)
      : (correctedLabel || document.querySelector('#hostStage .host-answer-key strong')?.textContent?.trim() || payload.correctLabel || '');
    if ((isNumeric && !Number.isFinite(expected)) || (isFreeText && !normalizeText(expected))) return;

    if (correctedQuestionId !== questionId || !correctedResults) {
      const results = {};
      for (const [id, player] of playersMap.entries()) {
        const answer = answersMap.get(id);
        const hostAward = Number(payload.lastResults?.[id]?.points) || 0;
        const baseline = scoreBaseline.has(id)
          ? Number(scoreBaseline.get(id)) || 0
          : Math.max(0, (Number(player?.score) || 0) - hostAward);
        const correct = Boolean(answer) && (isNumeric
          ? parseSingleNumber(answer.value) === expected
          : textAnswerIsCorrect(answer.value, expected));
        const points = pointsFor(answer, correct, payload);
        player.score = baseline + points;
        if (answer && typeof answer === 'object') {
          answer.correct = correct;
          answer.points = points;
        }
        results[id] = { correct, points };
      }
      correctedQuestionId = questionId;
      correctedResults = results;
      if (isFreeText) correctedLabel = String(expected);
    }

    payload.lastResults = { ...correctedResults };
    payload.ranking = rankingFromPlayers(payload.mode);
    payload.celebrate = Object.values(correctedResults).some((result) => result.points > 0);
    if (isFreeText && correctedLabel) payload.correctLabel = correctedLabel;
  }

  const originalCreateTransport = G.createTransport.bind(G);
  G.createTransport = function createTransportWithStrictScoring(options = {}) {
    const transport = originalCreateTransport(options);
    if (options.role !== 'host') return transport;
    const originalSend = transport.send.bind(transport);
    transport.send = (type, payload = {}) => {
      if (type === 'state' && payload && typeof payload === 'object') {
        captureBaseline(payload);
        applyStrictResult(payload);
      }
      return originalSend(type, payload);
    };
    return transport;
  };

  const observer = new MutationObserver(() => {
    const expected = document.querySelector('#hostStage .host-answer-key strong')?.textContent?.trim();
    if (expected) correctedLabel = expected;
    if (correctedQuestionId && correctedLabel) {
      const revealTitle = document.querySelector('#hostStage .host-question');
      if (revealTitle && /undefined/i.test(revealTitle.textContent || '')) revealTitle.textContent = `✅ ${correctedLabel}`;
    }
  });
  const start = () => observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();