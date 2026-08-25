(() => {
  const cfg = window.GRAND_QUIZ_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return;

  const previousFetch = window.fetch.bind(window);
  const generationPath = /\/api\/generate-questions(?:\?|$)/;
  const recentKey = 'grand-quiz-bank-recent-v1';
  const cacheKey = 'grand-quiz-bank-cache-v2';
  const acceptedMap = window.GRAND_QUIZ_ACCEPTED_ANSWERS || (window.GRAND_QUIZ_ACCEPTED_ANSWERS = new Map());
  const SPECIAL_TYPES = new Set(['truefalse', 'numeric', 'free', 'buzzer', 'intruder', 'estimation', 'progressive', 'image_mystery', 'location']);
  const SPECIAL_ORDER = ['intruder', 'truefalse', 'free', 'numeric', 'estimation', 'buzzer', 'progressive', 'image_mystery', 'location'];

  const read = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  const shuffle = (values) => window.GrandQuiz?.shuffle ? window.GrandQuiz.shuffle(values) : [...values].sort(() => Math.random() - 0.5);

  function status(text, ok = false) {
    const node = document.getElementById('generationStatus');
    if (!node) return;
    node.textContent = text;
    node.style.color = ok ? '#7bf8d3' : '#ffd166';
  }

  async function rpc(name, body) {
    const response = await previousFetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: cfg.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${cfg.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body || {}),
    });
    if (!response.ok) throw new Error(`Supabase ${response.status}`);
    return response.json();
  }

  function registerMedia(q) {
    if (!['image', 'clues', 'audio'].includes(q.format)) return;
    const library = window.GRAND_QUIZ_MEDIA_LIBRARY || (window.GRAND_QUIZ_MEDIA_LIBRARY = []);
    const item = { ...q };
    const index = library.findIndex((entry) => entry?.id === q.id);
    if (index >= 0) library[index] = item;
    else library.push(item);
  }

  function registerAnswers(q) {
    const values = [q.answerText, ...(q.acceptedAnswers || [])].filter(Boolean);
    if (values.length) acceptedMap.set(q.id, [...new Set(values)]);
  }

  function convert(row) {
    const a = row.answer || {};
    const original = String(row.type || 'mcq');
    const q = {
      id: `verified-${row.id}`,
      bankId: row.id,
      bankVerified: true,
      category: row.category,
      difficulty: row.difficulty,
      question: row.question,
      explanation: row.explanation || '',
      topicKey: row.topic_key || '',
      originalType: original,
      acceptedAnswers: Array.isArray(row.accepted_answers) ? row.accepted_answers : [],
    };

    if (original === 'mcq' || original === 'intruder') {
      q.type = 'mcq';
      q.options = Array.isArray(row.options) ? row.options : [];
      q.answer = Number.isInteger(Number(a.index))
        ? Number(a.index)
        : q.options.findIndex((x) => String(x) === String(a.text || a.value || ''));
      if (q.answer < 0 || q.options.length !== 4) return null;
    } else if (original === 'truefalse') {
      q.type = 'truefalse';
      q.answer = a.value === true || String(a.value).toLowerCase() === 'true' || String(a.text).toLowerCase() === 'vrai';
    } else if (original === 'numeric' || original === 'estimation') {
      q.type = 'numeric';
      q.answer = Number(a.value ?? a.text);
      q.unit = a.unit || '';
      if (!Number.isFinite(q.answer)) return null;
    } else if (original === 'buzzer') {
      q.type = 'buzzer';
      q.answerText = String(a.text || a.value || '').trim();
    } else if (original === 'progressive') {
      q.type = 'buzzer';
      q.answerText = String(a.text || a.value || '').trim();
      q.format = 'clues';
      q.clues = Array.isArray(row.clues) ? row.clues : [];
      if (q.clues.length < 3) return null;
    } else if (original === 'image_mystery' || original === 'location') {
      q.type = 'free';
      q.answerText = String(a.text || a.value || '').trim();
      q.format = 'image';
      q.media = { ...(row.media || {}), label: original === 'location' ? 'Où sommes-nous ?' : 'Image mystère' };
      if (!q.media?.src) return null;
    } else if (original === 'free') {
      q.type = 'free';
      q.answerText = String(a.text || a.value || '').trim();
    } else {
      return null;
    }

    if ((q.type === 'free' || q.type === 'buzzer') && !q.answerText) return null;
    registerAnswers(q);
    registerMedia(q);
    return q;
  }

  function formatMode() {
    return document.getElementById('specialFormatSelect')?.value || 'auto';
  }

  function desiredSpecialCount(count) {
    const mode = formatMode();
    if (mode === 'off') return 0;
    return Math.min(count, Math.max(1, Math.round(count * (mode === 'many' ? 0.4 : 0.25))));
  }

  function freshFirst(rows, recent) {
    const fresh = shuffle(rows.filter((row) => !recent.has(row.id)));
    const used = shuffle(rows.filter((row) => recent.has(row.id)));
    return [...fresh, ...used];
  }

  function takeBalancedSpecials(rows, count, recent) {
    if (!count) return [];
    const groups = new Map();
    for (const type of SPECIAL_ORDER) groups.set(type, freshFirst(rows.filter((row) => row.type === type), recent));
    const chosen = [];
    const order = shuffle(SPECIAL_ORDER);
    let guard = 0;
    while (chosen.length < count && guard < count * SPECIAL_ORDER.length * 3) {
      guard += 1;
      let progressed = false;
      for (const type of order) {
        if (chosen.length >= count) break;
        const group = groups.get(type) || [];
        const next = group.shift();
        if (!next) continue;
        chosen.push(next);
        progressed = true;
      }
      if (!progressed) break;
    }
    return chosen;
  }

  function spread(classics, specials, wanted) {
    const result = new Array(wanted).fill(null);
    if (specials.length) {
      specials.forEach((row, index) => {
        const raw = Math.round(((index + 1) * (wanted + 1)) / (specials.length + 1)) - 1;
        let pos = Math.max(1, Math.min(wanted - 1, raw));
        while (pos < wanted && result[pos]) pos += 1;
        if (pos >= wanted) {
          pos = wanted - 1;
          while (pos >= 0 && result[pos]) pos -= 1;
        }
        if (pos >= 0) result[pos] = row;
      });
    }
    let classicIndex = 0;
    let specialIndex = result.filter(Boolean).length;
    for (let i = 0; i < wanted; i += 1) {
      if (result[i]) continue;
      if (classicIndex < classics.length) result[i] = classics[classicIndex++];
      else if (specialIndex < specials.length) result[i] = specials[specialIndex++];
    }
    return result.filter(Boolean).slice(0, wanted);
  }

  function pick(rows, count) {
    const recent = new Set(read(recentKey, []));
    const specialWanted = desiredSpecialCount(count);
    const classicWanted = count - specialWanted;
    const classicPool = freshFirst(rows.filter((row) => row.type === 'mcq'), recent);
    const specialPool = rows.filter((row) => SPECIAL_TYPES.has(row.type));

    const classics = classicPool.slice(0, classicWanted);
    const specials = takeBalancedSpecials(specialPool, specialWanted, recent);
    const chosenIds = new Set([...classics, ...specials].map((row) => row.id));

    if (classics.length < classicWanted) {
      const extra = takeBalancedSpecials(specialPool.filter((row) => !chosenIds.has(row.id)), classicWanted - classics.length, recent);
      extra.forEach((row) => { specials.push(row); chosenIds.add(row.id); });
    }
    if (specials.length < specialWanted) {
      const extra = classicPool.filter((row) => !chosenIds.has(row.id)).slice(0, specialWanted - specials.length);
      extra.forEach((row) => { classics.push(row); chosenIds.add(row.id); });
    }

    if (classics.length + specials.length < count) {
      const remainder = freshFirst(rows.filter((row) => !chosenIds.has(row.id)), recent)
        .slice(0, count - classics.length - specials.length);
      for (const row of remainder) {
        if (row.type === 'mcq') classics.push(row);
        else specials.push(row);
        chosenIds.add(row.id);
      }
    }

    return spread(classics, specials, count);
  }

  function remember(ids) {
    const merged = [...read(recentKey, []), ...ids];
    write(recentKey, [...new Set(merged)].slice(-1200));
    rpc('mark_quiz_questions_played', { p_ids: ids }).catch(() => {});
  }

  function response(data, source = null) {
    const headers = new Headers(source?.headers || {});
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    return new Response(JSON.stringify(data), { status: 200, headers });
  }

  window.fetch = async function verifiedBankFetchV2(input, init = {}) {
    const url = typeof input === 'string' ? input : (input?.url || '');
    if (!generationPath.test(url) || typeof init.body !== 'string') return previousFetch(input, init);

    let body;
    try { body = JSON.parse(init.body); }
    catch { return previousFetch(input, init); }

    const categories = Array.isArray(body.categories) ? body.categories : [];
    const wanted = Math.max(1, Math.min(30, Number(body.count) || 1));
    if (!categories.length) return previousFetch(input, init);

    status('⚡ Sélection dans la banque PC-HERMES…');
    let rows = [];
    try {
      rows = await rpc('get_quiz_pack', {
        p_categories: categories,
        p_difficulty: body.difficulty || 'Mixte',
        p_limit: Math.min(500, Math.max(120, wanted * 16)),
      });
      if (rows.length) write(cacheKey, { savedAt: Date.now(), rows: rows.slice(0, 500) });
    } catch {
      const cache = read(cacheKey, {});
      rows = (cache.rows || []).filter((row) =>
        categories.includes(row.category) && (body.difficulty === 'Mixte' || row.difficulty === body.difficulty));
    }

    const selected = pick(rows, wanted);
    const questions = selected.map(convert).filter(Boolean);
    if (questions.length >= wanted) {
      remember(selected.slice(0, wanted).map((row) => row.id));
      const specialCount = questions.filter((q) => (q.originalType || q.type) !== 'mcq').length;
      status(`⚡ ${wanted} questions vérifiées · ${specialCount} format${specialCount > 1 ? 's' : ''} spécial${specialCount > 1 ? 'aux' : ''}.`, true);
      return response({
        questions: questions.slice(0, wanted),
        provider: 'verified-bank-v2',
        instantStart: true,
        specialFormats: specialCount,
        qualityControl: 'qwen+independent-gemini',
      });
    }

    status(`Banque ${questions.length}/${wanted} · Gemini complète en secours…`);
    const fallback = await previousFetch(input, { ...init, body: JSON.stringify({ ...body, count: wanted - questions.length }) });
    if (!fallback.ok) {
      return questions.length ? response({ questions, provider: 'verified-bank-v2-partial', partial: true }, fallback) : fallback;
    }
    const data = await fallback.clone().json().catch(() => ({}));
    remember(selected.map((row) => row.id));
    return response({
      ...data,
      questions: [...questions, ...(data.questions || [])].slice(0, wanted),
      provider: questions.length ? 'verified-bank-v2+gemini' : data.provider,
    }, fallback);
  };

  window.GrandQuizVerifiedBank = {
    stats: () => rpc('quiz_bank_counts', {}),
    clearRecent: () => localStorage.removeItem(recentKey),
  };
})();