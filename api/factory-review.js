const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const clean = (v, max=300) => String(v ?? '').replace(/\s+/g,' ').trim().slice(0,max);
const norm = (v) => clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/œ/g,'oe').replace(/[^a-z0-9]+/g,' ').trim();

function outputText(data){return (data?.candidates?.[0]?.content?.parts||[]).map(p=>typeof p?.text==='string'?p.text:'').join('').trim();}
function difficultyFromPct(pct){return pct>=70?'Facile':pct>=35?'Moyen':'Difficile';}
function containsAnswer(clue, answer){const c=norm(clue),a=norm(answer);return a.length>=4 && c.includes(a);}

function normalizeReview(raw, categories){
  if (!raw || raw.approved !== true) return null;
  const type=['mcq','truefalse','numeric','free','buzzer','intruder','estimation','progressive'].includes(raw.type)?raw.type:null;
  const category=clean(raw.category,60);
  const question=clean(raw.question,150);
  const pct=Math.max(1,Math.min(99,Number(raw.expected_success_pct)||0));
  const explanation=clean(raw.explanation,260);
  const topicKey=clean(raw.topic_key,140);
  const quality=Math.max(0,Math.min(100,Number(raw.quality_score)||0));
  if(!type||!categories.includes(category)||question.length<10||!topicKey||!explanation||pct<8||quality<72) return null;
  const base={id:clean(raw.id,120),approved:true,category,type,question,difficulty:difficultyFromPct(pct),expected_success_pct:pct,explanation,topic_key:topicKey,quality_score:quality,accepted_answers:Array.isArray(raw.accepted_answers)?raw.accepted_answers.map(x=>clean(x,100)).filter(Boolean).slice(0,8):[],clues:Array.isArray(raw.clues)?raw.clues.map(x=>clean(x,180)).filter(Boolean).slice(0,6):[]};

  if(type==='mcq'||type==='intruder'){
    const options=Array.isArray(raw.options)?raw.options.map(x=>clean(x,70)).filter(Boolean).slice(0,4):[];
    if(options.length!==4||new Set(options.map(norm)).size!==4) return null;
    const answer=clean(raw.answer,70); const index=options.findIndex(x=>norm(x)===norm(answer));
    if(index<0) return null;
    return {...base,options,answer,unit:''};
  }
  if(type==='truefalse'){
    const answer=norm(raw.answer); if(!['true','false','vrai','faux'].includes(answer)) return null;
    return {...base,options:[],answer:(answer==='true'||answer==='vrai')?'true':'false',unit:''};
  }
  if(type==='numeric'||type==='estimation'){
    const number=Number(String(raw.answer).replace(',','.')); if(!Number.isFinite(number)) return null;
    return {...base,options:[],answer:String(number),unit:clean(raw.unit,40)};
  }
  const answer=clean(raw.answer,100); if(!answer) return null;
  const accepted=[answer,...base.accepted_answers].filter((x,i,a)=>a.findIndex(y=>norm(y)===norm(x))===i).slice(0,8);
  if(type==='progressive'){
    if(base.clues.length<3||base.clues.some(c=>containsAnswer(c,answer))) return null;
  }
  return {...base,options:[],answer,accepted_answers:accepted,unit:''};
}

module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'Méthode non autorisée'});
  if(!process.env.GEMINI_API_KEY) return res.status(503).json({error:'GEMINI_API_KEY absente'});

  const body=req.body||{};
  const questions=Array.isArray(body.questions)?body.questions.slice(0,16):[];
  const categories=Array.isArray(body.categories)?body.categories.map(x=>clean(x,60)).filter(Boolean):[];
  if(!questions.length||!categories.length) return res.status(400).json({error:'Questions ou catégories manquantes'});

  const blind=questions.map(q=>({id:clean(q.id,120),category:clean(q.category,60),type:clean(q.type,30),question:clean(q.question,150),options:Array.isArray(q.options)?q.options.map(x=>clean(x,70)).slice(0,4):[],unit:clean(q.unit,40),clues:Array.isArray(q.clues)?q.clues.map(x=>clean(x,180)).slice(0,6):[]}));
  const schema={type:'object',required:['reviews'],properties:{reviews:{type:'array',items:{type:'object',required:['id','approved','category','type','question','options','answer','unit','accepted_answers','explanation','topic_key','clues','expected_success_pct','quality_score'],properties:{id:{type:'string'},approved:{type:'boolean'},category:{type:'string'},type:{type:'string',enum:['mcq','truefalse','numeric','free','buzzer','intruder','estimation','progressive']},question:{type:'string'},options:{type:'array',items:{type:'string'}},answer:{type:'string'},unit:{type:'string'},accepted_answers:{type:'array',items:{type:'string'}},explanation:{type:'string'},topic_key:{type:'string'},clues:{type:'array',items:{type:'string'}},expected_success_pct:{type:'number'},quality_score:{type:'integer'}}}}}};

  const prompt=[
    'Tu es le vérificateur FINAL et INDÉPENDANT d’un quiz français pour adultes. Les réponses proposées par le premier modèle t’ont volontairement été cachées.',
    'Résous chaque question toi-même. Si tu as le moindre doute factuel, si plusieurs réponses sont défendables, si le fait dépend de l’actualité ou si la formulation est trompeuse : approved=false.',
    'Ne valide que des connaissances stables. Refuse les légendes populaires, records non datés susceptibles de changer, célébrités basées sur rumeurs/vie privée, statistiques mouvantes et détails arbitrairement obscurs.',
    'Pour QCM et intrus : 4 choix homogènes, exactement une réponse correcte. answer doit recopier exactement le bon choix.',
    'Pour truefalse : answer=true ou false. Pour numeric/estimation : une valeur exacte stable servant de référence.',
    'Pour free/buzzer : réponse courte et unique ; accepted_answers contient seulement de vraies variantes équivalentes, jamais des réponses approximatives.',
    'Pour progressive : 3 à 5 indices tous exacts, du plus difficile au plus évident, sans écrire la réponse dans un indice.',
    'Calibre expected_success_pct pour un adulte francophone de culture générale : 70-95 facile, 35-69 moyen, 8-34 difficile. En dessous de 8 %, rejette comme trop obscur.',
    'quality_score mesure exactitude + clarté + intérêt ludique. Mets moins de 72 si la question ne mérite pas une partie réelle.',
    'topic_key identifie le FAIT testé et doit permettre de repérer deux formulations différentes du même fait.',
    `Catégories autorisées : ${categories.join(', ')}.`,
    `QUESTIONS À RÉSOUDRE : ${JSON.stringify(blind)}`
  ].join('\n\n');

  try{
    const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
    const r=await fetch(endpoint,{method:'POST',headers:{'x-goog-api-key':process.env.GEMINI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0.02,topP:0.4,maxOutputTokens:18000,responseMimeType:'application/json',responseSchema:schema}})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok) return res.status(r.status===429?429:502).json({error:data?.error?.message||'Vérification Gemini impossible'});
    const text=outputText(data); if(!text) return res.status(502).json({error:'Réponse vide du vérificateur'});
    const parsed=JSON.parse(text);
    const approved=(parsed.reviews||[]).map(x=>normalizeReview(x,categories)).filter(Boolean);
    res.status(200).json({questions:approved,reviewedCount:questions.length,approvedCount:approved.length,model:MODEL,qualityControl:'blind-factory-review-v1'});
  }catch(e){console.error(e);res.status(500).json({error:'Erreur du contrôleur de la fabrique'});}
};
