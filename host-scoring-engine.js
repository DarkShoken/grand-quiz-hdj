(() => {
  const G = window.GrandQuiz;
  if (!G || typeof G.createTransport !== 'function') return;

  const NativeMap = window.Map;
  const nativeGet = NativeMap.prototype.get;
  const nativeSet = NativeMap.prototype.set;
  let playersMap = null;
  let answersMap = null;
  let capturedMaps = 0;
  let lastTextQuestionId = null;
  let lastTextResults = null;
  let lastTextExpected = '';
  let activeQuestionToken = '';
  const latestRevision = new NativeMap();

  function normalizeText(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/œ/g, 'oe')
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
    const left = String(a ?? '').match(/\d+/g) || [];
    const right = String(b ?? '').match(/\d+/g) || [];
    return left.join('|') === right.join('|');
  }

  function isFreeTextType(type) {
    return !['mcq', 'truefalse', 'numeric', 'buzzer'].includes(String(type || '').toLowerCase());
  }

  function textAnswerIsCorrect(submitted, expected) {
    const left = normalizeText(submitted);
    const right = normalizeText(expected);
    if (!left || !right || !sameDigits(submitted, expected)) return false;
    if (left === right) return true;
    const distance = levenshtein(left, right);
    const allowed = right.length >= 14 ? 2 : right.length >= 6 ? 1 : 0;
    return distance <= allowed && distance / Math.max(left.length, right.length) <= 0.14;
  }

  function pointsFor(answer, correct, payload) {
    if (!correct) return 0;
    let points = 1000;
    if (payload.speedBonus) {
      const duration = Math.max(1, Number(payload.durationMs) || 20000);
      const elapsed = Math.max(0, Number(answer?.elapsed) || duration);
      points += Math.max(0, Math.round(500 * (1 - Math.min(1, elapsed / duration))));
    }
    return points;
  }

  function publicPlayers() {
    if (!playersMap) return [];
    return [...playersMap.values()].map(({ id, name, team, score, online }) => ({
      id, name, team, score: Number(score) || 0, online,
    }));
  }

  function ranking(mode) {
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

  function installEditableAnswers() {
    if (!playersMap || !answersMap) return;

    Object.defineProperty(answersMap, 'has', {
      configurable: true,
      value() { return false; },
    });

    Object.defineProperty(answersMap, 'set', {
      configurable: true,
      value(playerId, nextAnswer) {
        const previous = nativeGet.call(this, playerId);
        const player = nativeGet.call(playersMap, playerId);
        if (previous && player) {
          player.score = Math.max(0, (Number(player.score) || 0) - (Number(previous.points) || 0));
        }
        if (nextAnswer && typeof nextAnswer === 'object') {
          nextAnswer.revisions = previous ? (Number(previous.revisions) || 0) + 1 : 0;
        }
        return nativeSet.call(this, playerId, nextAnswer);
      },
    });
  }

  class CapturedMap extends NativeMap {
    constructor(iterable) {
      super(iterable);
      capturedMaps += 1;
      if (capturedMaps === 1) playersMap = this;
      if (capturedMaps === 2) {
        answersMap = this;
        installEditableAnswers();
        window.Map = NativeMap;
      }
    }
  }

  window.Map = CapturedMap;

  function expectedFromHost(payload) {
    const dom = document.querySelector('#hostStage .host-answer-key strong')?.textContent?.trim() || '';
    if (dom && !/^undefined$/i.test(dom) && dom !== '—') return dom;
    const label = String(payload?.correctLabel ?? '').trim();
    if (label && !/^undefined$/i.test(label) && label !== '—') return label;
    return '';
  }

  function scoreFreeText(payload) {
    if (!playersMap || !answersMap || payload.phase !== 'reveal' || !payload.question?.id) return;
    if (!isFreeTextType(payload.question.type)) return;

    const questionId = payload.question.id;
    const expected = expectedFromHost(payload);
    if (!normalizeText(expected)) return;

    if (lastTextQuestionId !== questionId || !lastTextResults) {
      const results = {};
      for (const [id, player] of playersMap.entries()) {
        const answer = nativeGet.call(answersMap, id);
        if (answer?.scoredQuestionId === questionId && typeof answer.correct === 'boolean') {
          results[id] = { correct: answer.correct, points: Number(answer.points) || 0 };
          continue;
        }

        const correct = Boolean(answer) && textAnswerIsCorrect(answer.value, expected);
        const points = pointsFor(answer, correct, payload);
        if (answer && typeof answer === 'object') {
          answer.correct = correct;
          answer.points = points;
          answer.scoredQuestionId = questionId;
        }
        if (player) player.score = (Number(player.score) || 0) + points;
        results[id] = { correct, points };
      }
      lastTextQuestionId = questionId;
      lastTextResults = results;
      lastTextExpected = expected;
    }

    payload.lastResults = { ...lastTextResults };
    payload.correctLabel = lastTextExpected || expected;
    payload.celebrate = Object.values(lastTextResults).some((result) => result.points > 0);
    payload.players = publicPlayers();
    payload.ranking = ranking(payload.mode);
  }

  function syncQuestionBoundary(payload) {
    if (payload.phase !== 'question' || !payload.question?.id) return;
    const token = `${Number(payload.questionIndex) || 0}|${payload.question.id}`;
    if (token === activeQuestionToken) return;
    activeQuestionToken = token;
    latestRevision.clear();
    lastTextQuestionId = null;
    lastTextResults = null;
    lastTextExpected = '';
  }

  function syncPublicAnswerState(payload) {
    if (!answersMap || !payload || typeof payload !== 'object') return;
    payload.playerAnswers = Object.fromEntries(
      [...answersMap.entries()].map(([playerId, answer]) => [playerId, answer?.value]),
    );
    payload.answeredPlayerIds = [...answersMap.keys()];
    if (playersMap && payload.phase !== 'reveal') {
      payload.players = publicPlayers();
      payload.ranking = ranking(payload.mode);
    }
  }

  const originalCreateTransport = G.createTransport.bind(G);
  G.createTransport = function createTransportWithScoring(options = {}) {
    let transport = null;
    const originalOnMessage = options.onMessage;

    transport = originalCreateTransport({
      ...options,
      onMessage(message) {
        if (options.role === 'host' && message?.type === 'answer') {
          const p = message.payload || {};
          const key = `${p.playerId || ''}|${p.questionId || ''}`;
          const revision = Number.isFinite(Number(p.revision)) ? Number(p.revision) : 0;
          if (latestRevision.has(key) && revision <= latestRevision.get(key)) {
            transport?.send('answer_ack', {
              playerId: p.playerId,
              questionId: p.questionId,
              accepted: true,
            });
            return;
          }
          latestRevision.set(key, revision);
        }
        originalOnMessage?.(message);
      },
    });

    if (options.role === 'host') {
      const originalSend = transport.send.bind(transport);
      transport.send = (type, payload = {}) => {
        if (type === 'state' && payload && typeof payload === 'object') {
          syncQuestionBoundary(payload);
          scoreFreeText(payload);
          syncPublicAnswerState(payload);
        }
        return originalSend(type, payload);
      };
    }

    return transport;
  };
})();
