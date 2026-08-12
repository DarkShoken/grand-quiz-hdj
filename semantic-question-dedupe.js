(() => {
  const HISTORY_KEY = 'grand-quiz-semantic-history-v2';
  const LEGACY_HISTORY_KEYS = ['grand-quiz-semantic-history-v1', 'grand-quiz-used-questions-v2'];
  const SESSION_PREFIX = 'grand-quiz-session-v2:';
  const MAX_HISTORY = 500;
  const nativeFetch = window.fetch.bind(window);
  const nativeSetItem = Storage.prototype.setItem;

  const STOP_WORDS = new Set([
    'a','ai','au','aux','avec','ce','ces','cet','cette','comme','comment','dans','de','des','du','elle','en','est','et','etre','fait','font','il','ils','la','le','les','leur','leurs','lui','mais','ne','nom','nous','ou','par','parmi','pas','plus','pour','qu','que','quel','quelle','quelles','quels','qui','quoi','sa','se','ses','son','sont','sur','un','une','vers','vous','y',
    'appelle','appellent','correspond','donne','indique','trouve','trouvent','possede','possedent','suivant','suivante','suivants','suivantes','reponse','question'
  ]);

  function normalize(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/œ/g, 'oe')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stem(token) {
    if (token.length > 7 && token.endsWith('ements')) return token.slice(0, -6);
    if (token.length > 6 && token.endsWith('ement')) return token.slice(0, -5);
    if (token.length > 6 && token.endsWith('ations')) return token.slice(0, -5);
    if (token.length > 5 && token.endsWith('iques')) return token.slice(0, -2);
    if (token.length > 5 && token.endsWith('es')) return token.slice(0, -2);
    if (token.length > 4 && (token.endsWith('s') || token.endsWith('x'))) return token.slice(0, -1);
    return token;
  }

  function tokens(value) {
    return new Set(normalize(value).split(' ')
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
      .map(stem)
      .filter(Boolean));
  }

  function expectedAnswer(question) {
    if (!question || typeof question !== 'object') return '';
    const type = String(question.type || '').toLowerCase();
    if (type === 'mcq') return question.options?.[Number(question.answer)] ?? '';
    if (type === 'truefalse') return question.answer === true || String(question.answer) === 'true' ? 'vrai' : 'faux';
    if (type === 'numeric') return `${question.answer ?? ''} ${question.unit || ''}`;
    return question.answerText ?? question.answer ?? '';
  }

  function toEntry(value) {
    if (typeof value === 'string') {
      return { question: value, category: '', type: '', answer: '', options: [], topicKey: '' };
    }
    const question = value && typeof value === 'object' ? value : {};
    return {
      question: String(question.question || '').trim(),
      category: String(question.category || '').trim(),
      type: String(question.type || '').toLowerCase(),
      answer: String(expectedAnswer(question) || '').trim(),
      options: Array.isArray(question.options) ? question.options.map((option) => String(option || '').trim()).filter(Boolean) : [],
      topicKey: String(question.topicKey || '').trim(),
    };
  }

  function overlapStats(left, right) {
    let shared = 0;
    for (const item of left) if (right.has(item)) shared += 1;
    const union = left.size + right.size - shared;
    return {
      shared,
      jaccard: union ? shared / union : 0,
      containment: Math.min(left.size, right.size) ? shared / Math.min(left.size, right.size) : 0,
    };
  }

  function optionSimilarity(a, b) {
    const left = new Set((a.options || []).map(normalize).filter(Boolean));
    const right = new Set((b.options || []).map(normalize).filter(Boolean));
    if (!left.size || !right.size) return 0;
    let shared = 0;
    for (const option of left) if (right.has(option)) shared += 1;
    return shared / Math.min(left.size, right.size);
  }

  function isSemanticDuplicate(leftValue, rightValue) {
    const left = toEntry(leftValue);
    const right = toEntry(rightValue);
    const leftQuestion = normalize(left.question);
    const rightQuestion = normalize(right.question);
    if (!leftQuestion || !rightQuestion) return false;
    if (leftQuestion === rightQuestion) return true;

    const leftTopic = normalize(left.topicKey);
    const rightTopic = normalize(right.topicKey);
    if (leftTopic && rightTopic && leftTopic === rightTopic) return true;

    const leftTokens = tokens(left.question);
    const rightTokens = tokens(right.question);
    const overlap = overlapStats(leftTokens, rightTokens);
    const sameCategory = !left.category || !right.category || normalize(left.category) === normalize(right.category);
    const leftAnswer = normalize(left.answer);
    const rightAnswer = normalize(right.answer);
    const sameAnswer = Boolean(leftAnswer && rightAnswer && leftAnswer === rightAnswer && !['vrai', 'faux'].includes(leftAnswer));
    const options = optionSimilarity(left, right);

    if (overlap.shared >= 2 && (overlap.jaccard >= 0.5 || overlap.containment >= 0.68)) return true;
    if (sameCategory && options >= 0.75) return true;
    if (sameCategory && sameAnswer && overlap.shared >= 2 && (overlap.jaccard >= 0.22 || overlap.containment >= 0.4)) return true;
    if (sameCategory && sameAnswer && overlap.shared >= 1 && Math.max(leftTokens.size, rightTokens.size) <= 6) return true;
    if (sameCategory && sameAnswer && options >= 0.5) return true;
    return false;
  }

  function dedupe(candidates, blockers = [], limit = Infinity) {
    const accepted = [];
    for (const candidate of candidates || []) {
      if (!candidate?.question) continue;
      if (blockers.some((blocked) => isSemanticDuplicate(candidate, blocked))) continue;
      if (accepted.some((kept) => isSemanticDuplicate(candidate, kept))) continue;
      accepted.push(candidate);
      if (accepted.length >= limit) break;
    }
    return accepted;
  }

  function loadJsonArray(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function loadHistory() {
    const all = [
      ...loadJsonArray(HISTORY_KEY),
      ...LEGACY_HISTORY_KEYS.flatMap(loadJsonArray),
    ].map(toEntry).filter((entry) => entry.question);
    return dedupe(all).slice(-MAX_HISTORY);
  }

  function saveHistory(entries) {
    const cleaned = dedupe(entries).slice(-MAX_HISTORY).map(toEntry);
    nativeSetItem.call(localStorage, HISTORY_KEY, JSON.stringify(cleaned));
  }

  function captureLatestSession() {
    let newest = null;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(SESSION_PREFIX)) continue;
      try {
        const session = JSON.parse(localStorage.getItem(key) || 'null');
        if (!session?.savedAt || !Array.isArray(session.selectedQuestions)) continue;
        if (!newest || session.savedAt > newest.savedAt) newest = session;
      } catch {}
    }
    if (newest?.selectedQuestions?.length) {
      saveHistory([...loadHistory(), ...newest.selectedQuestions]);
    }
  }

  Storage.prototype.setItem = function semanticHistorySetItem(key, value) {
    nativeSetItem.call(this, key, value);
    if (this === localStorage && (key === 'grand-quiz-used-questions-v2' || key.startsWith(SESSION_PREFIX))) {
      queueMicrotask(captureLatestSession);
    }
  };

  function prepareLocalBank() {
    const bank = window.GRAND_QUIZ_QUESTIONS;
    if (!Array.isArray(bank)) return;
    const fresh = dedupe(bank, loadHistory());
    bank.splice(0, bank.length, ...fresh);
  }

  function pruneLocalBankAgainst(questions) {
    const bank = window.GRAND_QUIZ_QUESTIONS;
    if (!Array.isArray(bank) || !questions?.length) return;
    const remaining = bank.filter((question) => !questions.some((used) => isSemanticDuplicate(question, used)));
    bank.splice(0, bank.length, ...remaining);
  }

  function isGenerationRequest(input) {
    const url = typeof input === 'string' ? input : input?.url;
    return typeof url === 'string' && /\/api\/generate-questions(?:\?|$)/.test(url);
  }

  function jsonResponse(data, response, status = response?.status || 200) {
    const headers = new Headers(response?.headers || {});
    headers.set('Content-Type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(data), {
      status,
      statusText: response?.statusText || '',
      headers,
    });
  }

  async function reviewQuestions(questions, categories, blockers) {
    const response = await nativeFetch('/api/review-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questions,
        categories,
        history: blockers.slice(-100),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'La seconde vérification des questions a échoué.');
    return Array.isArray(data.questions) ? data.questions : [];
  }

  window.fetch = async function semanticDedupeFetch(input, init = {}) {
    if (!isGenerationRequest(input) || typeof init.body !== 'string') return nativeFetch(input, init);

    let originalBody;
    try {
      originalBody = JSON.parse(init.body);
    } catch {
      return nativeFetch(input, init);
    }

    const wanted = Math.max(1, Math.min(30, Number(originalBody.count) || 1));
    const history = loadHistory();
    const explicitBlockers = [
      ...(Array.isArray(originalBody.excludeEntries) ? originalBody.excludeEntries : []),
      ...(Array.isArray(originalBody.exclude) ? originalBody.exclude : []),
    ].map(toEntry).filter((entry) => entry.question);
    const blockers = dedupe([...history, ...explicitBlockers]);
    const accepted = [];
    let lastResponse = null;
    let lastData = null;
    let received = 0;
    let reviewed = 0;

    try {
      for (let attempt = 0; attempt < 2 && accepted.length < wanted; attempt += 1) {
        const missing = wanted - accepted.length;
        const requestCount = Math.min(30, Math.max(missing + 4, wanted));
        const excludeQuestions = dedupe([...blockers, ...accepted])
          .slice(-100)
          .map((entry) => entry.question || entry);
        const body = {
          ...originalBody,
          count: requestCount,
          exclude: excludeQuestions,
        };

        const response = await nativeFetch(input, { ...init, body: JSON.stringify(body) });
        lastResponse = response;
        const data = await response.json().catch(() => ({}));
        lastData = data;
        if (!response.ok) {
          if (!accepted.length) return jsonResponse(data, response, response.status);
          break;
        }

        const rawCandidates = Array.isArray(data.questions) ? data.questions : [];
        received += rawCandidates.length;
        const reviewedCandidates = await reviewQuestions(
          rawCandidates,
          Array.isArray(originalBody.categories) ? originalBody.categories : [],
          dedupe([...blockers, ...accepted]),
        );
        reviewed += reviewedCandidates.length;

        for (const candidate of reviewedCandidates) {
          if (accepted.length >= wanted) break;
          if (blockers.some((blocked) => isSemanticDuplicate(candidate, blocked))) continue;
          if (accepted.some((kept) => isSemanticDuplicate(candidate, kept))) continue;
          accepted.push(candidate);
        }
      }
    } catch (error) {
      return jsonResponse({
        error: error.message || 'Le contrôle qualité approfondi a échoué.',
        code: 'quality_review_failed',
      }, lastResponse, 502);
    }

    pruneLocalBankAgainst(accepted);
    const result = {
      ...(lastData || {}),
      questions: accepted.slice(0, wanted),
      qualityControl: 'generation-plus-independent-review-v3-fast',
      semanticDeduplication: {
        requested: wanted,
        retained: Math.min(wanted, accepted.length),
        generated: received,
        approvedByReviewer: reviewed,
        historyCompared: blockers.length,
      },
    };

    if (accepted.length < wanted) {
      return jsonResponse({
        ...result,
        error: `Contrôle qualité : ${accepted.length}/${wanted} questions validées. Le moteur rapide complétera si nécessaire.`,
      }, lastResponse, 502);
    }

    return jsonResponse(result, lastResponse, 200);
  };

  prepareLocalBank();
  window.GrandQuizSemanticDedupe = { isSemanticDuplicate, dedupe, loadHistory };
})();
