(() => {
  const cfg = window.GRAND_QUIZ_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return;
  const previousFetch = window.fetch.bind(window);
  const generationPath = /\/api\/generate-questions(?:\?|$)/;
  const recentKey = 'grand-quiz-bank-recent-v1';
  const cacheKey = 'grand-quiz-bank-cache-v1';
  const acceptedMap = window.GRAND_QUIZ_ACCEPTED_ANSWERS || (window.GRAND_QUIZ_ACCEPTED_ANSWERS = new Map());

  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  const shuffle = (values) => window.GrandQuiz?.shuffle ? window.GrandQuiz.shuffle(values) : [...values].sort(() => Math.random() - .5);

  function status(text, ok = false) {
    const node = document.getElementById('generationStatus');
    if (!node) return;
    node.textContent = text;
    node.style.color = ok ? '#7bf8d3' : '#ffd166';
  }

  async function rpc(name, body) {
    const response = await previousFetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${cfg.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    if (!response.ok) throw new Error(`Supabase ${response.status}`);
    return response.json();
  }

  function registerMedia(q) {
    if (!['image','clues','audio'].includes(q.format)) return;
    const library = window.GRAND_QUIZ_MEDIA_LIBRARY || (window.GRAND_QUIZ_MEDIA_LIBRARY = []);
    const item = { ...q };
    const index = library.findIndex((entry) => entry?.id === q.id);
    if (index >= 0) library[index] = item; else library.push(item);
  }

  function registerAnswers(q) {
    const values = [q.answerText, ...(q.acceptedAnswers || [])].filter(Boolean);
    if (values.length) acceptedMap.set(q.id, [...new Set(values)]);
  }

  function convert(row) {
    const a = row.answer || {};
    const original = String(row.type || 'mcq');
    const q = { id:`verified-${row.id}`, bankId:row.id, bankVerified:true, category:row.category, difficulty:row.difficulty, question:row.question, explanation:row.explanation || '', topicKey:row.topic_key || '', originalType:original, acceptedAnswers:Array.isArray(row.accepted_answers)?row.accepted_answers:[] };
    if (original === 'mcq' || original === 'intruder') {
      q.type='mcq'; q.options=Array.isArray(row.options)?row.options:[];
      q.answer=Number.isInteger(Number(a.index))?Number(a.index):q.options.findIndex(x=>String(x)===String(a.text||a.value||''));
      if (q.answer < 0) return null;
    } else if (original === 'truefalse') {
      q.type='truefalse'; q.answer=a.value===true || String(a.value).toLowerCase()==='true' || String(a.text).toLowerCase()==='vrai';
    } else if (original === 'numeric' || original === 'estimation') {
      q.type='numeric'; q.answer=Number(a.value ?? a.text); q.unit=a.unit || '';
      if (!Number.isFinite(q.answer)) return null;
    } else if (original === 'buzzer') {
      q.type='buzzer'; q.answerText=String(a.text||a.value||'').trim();
    } else if (original === 'progressive') {
      q.type='buzzer'; q.answerText=String(a.text||a.value||'').trim(); q.format='clues'; q.clues=Array.isArray(row.clues)?row.clues:[];
    } else if (original === 'image_mystery' || original === 'location') {
      q.type='free'; q.answerText=String(a.text||a.value||'').trim(); q.format='image'; q.media={...(row.media||{}),label:original==='location'?'Où sommes-nous ?':'Image mystère'};
    } else if (original === 'free') {
      q.type='free'; q.answerText=String(a.text||a.value||'').trim();
    } else return null;
    if ((q.type==='free'||q.type==='buzzer') && !q.answerText) return null;
    if (q.format==='image' && !q.media?.src) return null;
    registerAnswers(q);
    registerMedia(q);
    return q;
  }

  function pick(rows, count) {
    const recent = new Set(read(recentKey, []));
    const fresh = rows.filter(row => !recent.has(row.id));
    const source = fresh.length >= count ? fresh : [...fresh, ...rows.filter(row => recent.has(row.id))];
    const result=[]; let last='';
    for (const row of shuffle(source)) {
      if (result.length>=count) break;
      if (row.type===last && source.some(x=>x.type!==last && !result.includes(x))) continue;
      result.push(row); last=row.type;
    }
    for (const row of shuffle(source)) if (result.length<count && !result.includes(row)) result.push(row);
    return result.slice(0,count);
  }

  function remember(ids) {
    const merged=[...read(recentKey,[]),...ids];
    write(recentKey,[...new Set(merged)].slice(-1200));
    rpc('mark_quiz_questions_played',{p_ids:ids}).catch(()=>{});
  }

  function response(data, source=null) {
    const headers=new Headers(source?.headers||{}); headers.set('Content-Type','application/json; charset=utf-8'); headers.set('Cache-Control','no-store');
    return new Response(JSON.stringify(data),{status:200,headers});
  }

  window.fetch = async function verifiedBankFetch(input, init={}) {
    const url=typeof input==='string'?input:(input?.url||'');
    if (!generationPath.test(url) || typeof init.body!=='string') return previousFetch(input,init);
    let body; try { body=JSON.parse(init.body); } catch { return previousFetch(input,init); }
    const categories=Array.isArray(body.categories)?body.categories:[];
    const wanted=Math.max(1,Math.min(30,Number(body.count)||1));
    if (!categories.length) return previousFetch(input,init);

    status('⚡ Sélection dans la banque déjà vérifiée…');
    let rows=[];
    try {
      rows=await rpc('get_quiz_pack',{p_categories:categories,p_difficulty:body.difficulty||'Mixte',p_limit:Math.min(500,Math.max(100,wanted*12))});
      if (rows.length) write(cacheKey,{savedAt:Date.now(),rows:rows.slice(0,350)});
    } catch {
      const cache=read(cacheKey,{}); rows=(cache.rows||[]).filter(r=>categories.includes(r.category)&&(body.difficulty==='Mixte'||r.difficulty===body.difficulty));
    }
    const selected=pick(rows,wanted);
    const questions=selected.map(convert).filter(Boolean);
    if (questions.length>=wanted) {
      remember(selected.slice(0,wanted).map(r=>r.id));
      status(`⚡ ${wanted} questions vérifiées prêtes.`,true);
      return response({questions:questions.slice(0,wanted),provider:'verified-bank',instantStart:true,qualityControl:'qwen+independent-gemini'});
    }

    status(`Banque ${questions.length}/${wanted} · Gemini complète en secours…`);
    const fallback=await previousFetch(input,{...init,body:JSON.stringify({...body,count:wanted-questions.length})});
    if (!fallback.ok) return questions.length?response({questions,provider:'verified-bank-partial',partial:true},fallback):fallback;
    const data=await fallback.clone().json().catch(()=>({}));
    remember(selected.map(r=>r.id));
    return response({...data,questions:[...questions,...(data.questions||[])].slice(0,wanted),provider:questions.length?'verified-bank+gemini':data.provider},fallback);
  };

  window.GrandQuizVerifiedBank={stats:()=>rpc('quiz_bank_counts',{}),clearRecent:()=>localStorage.removeItem(recentKey)};
})();
