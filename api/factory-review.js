const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const clean = (v, max=300) => String(v ?? '').replace(/\s+/g,' ').trim().slice(0,max);
const norm = (v) => clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/œ/g,'oe').replace(/[^a-z0-9]+/g,' ').trim();

function outputText(data){return (data?.candidates?.[0]?.content?.parts||[]).map(p=>typeof p?.text==='string'?p.text:'').join('').trim();}
function difficultyFromPct(pct){return pct>=70?'Facile':pct>=35?'Moyen':'Difficile';}
function containsAnswer(clue, answer){const c=norm(clue),a=norm(answer);return a.length>=4 && c.includes(a);}

function wordSet(value){
  return new Set(norm(value).split(' ').filter(x=>x.length>=4 && !['quel','quelle','quels','quelles','dans','avec','pour','permet','sont','cette','comme'].includes(x)));
}
function overlapRatio(a,b){
  const left=wordSet(a),right=wordSet(b); if(!left.size||!right.size)return 0;
  let common=0; for(const x of left)if(right.has(x))common++;
  return common/Math.min(left.size,right.size);
}
function progressiveCluesAreGood(clues, question, answer){
  if(clues.length<4||clues.length>5)return false;
  if(clues.some(c=>containsAnswer(c,answer)))return false;
  if(clues.some(c=>overlapRatio(c,question)>.72))return false;
  for(let i=0;i<clues.length;i++)for(let j=i+1;j<clues.length;j++)if(overlapRatio(clues[i],clues[j])>.78)return false;
  return true;
}

function extractGrounding(data){
  const gm=data?.candidates?.[0]?.groundingMetadata||{};
  const sources=[];
  for(const chunk of gm.groundingChunks||[]){
    const web=chunk?.web;
    if(!web?.uri)continue;
    if(!sources.some(x=>x.url===web.uri))sources.push({source:'Google Search',title:clean(web.title,180),url:web.uri});
  }
  return {text:outputText(data),sources:sources.slice(0,16),queries:(gm.webSearchQueries||[]).map(x=>clean(x,180)).filter(Boolean).slice(0,16)};
}

function normalizeReview(raw, categories, evidence){
  if (!raw || raw.approved !== true) return null;
  const type=['mcq','truefalse','numeric','free','buzzer','intruder','estimation','progressive'].includes(raw.type)?raw.type:null;
  const category=clean(raw.category,60);
  const question=clean(raw.question,150);
  const pct=Math.max(1,Math.min(99,Number(raw.expected_success_pct)||0));
  const explanation=clean(raw.explanation,260);
  const topicKey=clean(raw.topic_key,140);
  const quality=Math.max(0,Math.min(100,Number(raw.quality_score)||0));
  if(!type||!categories.includes(category)||question.length<10||!topicKey||!explanation||pct<8||quality<76) return null;
  const base={id:clean(raw.id,120),approved:true,category,type,question,difficulty:difficultyFromPct(pct),expected_success_pct:pct,explanation,topic_key:topicKey,quality_score:quality,accepted_answers:Array.isArray(raw.accepted_answers)?raw.accepted_answers.map(x=>clean(x,100)).filter(Boolean).slice(0,8):[],clues:Array.isArray(raw.clues)?raw.clues.map(x=>clean(x,180)).filter(Boolean).slice(0,5):[],source_evidence:evidence.sources,verification_evidence:{queries:evidence.queries,grounded:true}};

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
  if(type==='progressive'&&!progressiveCluesAreGood(base.clues,question,answer)) return null;
  return {...base,options:[],answer,accepted_answers:accepted,unit:''};
}

async function groundedFactCheck(blind){
  const prompt=[
    'Tu es documentaliste fact-checker d’un quiz français pour adultes.',
    'Les réponses du modèle auteur sont volontairement ABSENTES : ne suppose jamais qu’il avait raison.',
    'Utilise Google Search pour vérifier chaque question séparément. Pour chaque ID, détermine la réponse exacte à partir de sources fiables et stables.',
    'Privilégie les sources institutionnelles, encyclopédiques reconnues, fédérations/organismes officiels, musées, universités ou documentation technique de référence.',
    'Si les sources se contredisent, si plusieurs réponses sont défendables, si la question dépend de l’actualité ou si tu ne trouves pas de support net, écris REJETER pour cet ID.',
    'Pour un QCM/intrus, contrôle aussi que les trois autres propositions sont réellement fausses dans le cadre exact de la question.',
    'Pour une question progressive, vérifie séparément chaque indice et signale tout indice faux, trop révélateur ou redondant.',
    'Réponds en texte structuré par ID avec : verdict, réponse indépendante, justification factuelle. Les citations Google Search sont indispensables.',
    `QUESTIONS : ${JSON.stringify(blind)}`
  ].join('\n\n');
  const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
  const r=await fetch(endpoint,{method:'POST',headers:{'x-goog-api-key':process.env.GEMINI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],tools:[{google_search:{}}],generationConfig:{temperature:0,maxOutputTokens:12000}})});
  const data=await r.json().catch(()=>({}));
  if(!r.ok){const err=new Error(data?.error?.message||'Fact-check Google Search impossible');err.status=r.status;throw err;}
  const evidence=extractGrounding(data);
  if(!evidence.text||!evidence.sources.length){const err=new Error('Le fact-check n’a renvoyé aucune source exploitable.');err.status=502;throw err;}
  return evidence;
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

  try{
    const evidence=await groundedFactCheck(blind);
    const prompt=[
      'Tu es le rédacteur en chef FINAL d’un quiz français pour adultes.',
      'Tu disposes ci-dessous d’un DOSSIER FACTUEL produit indépendamment avec Google Search. Les réponses du premier auteur ne t’ont jamais été montrées.',
      'approved=true UNIQUEMENT lorsque le dossier factuel soutient explicitement une réponse unique pour cet ID. En cas de doute, approved=false.',
      'Résous encore la question toi-même à partir du dossier. N’invente aucune donnée qui n’y figure pas.',
      'Pour QCM et intrus : 4 choix homogènes, exactement une réponse correcte. answer recopie exactement le bon choix.',
      'Pour truefalse : answer=true ou false. Pour numeric/estimation : une valeur exacte stable servant de référence.',
      'Pour free/buzzer : réponse courte et unique ; accepted_answers contient uniquement des variantes strictement équivalentes.',
      'Pour progressive : RÉÉCRIS les indices si nécessaire. Il faut exactement 4 ou 5 indices vrais et non redondants, réellement ordonnés du plus difficile au plus évident. Le premier doit être indirect et exigeant ; il ne doit ni reformuler la définition de la réponse ni rendre la solution immédiate. Le dernier peut être très aidant mais ne doit jamais contenir la réponse. Aucun indice ne doit simplement paraphraser la question.',
      'Calibre expected_success_pct pour un adulte francophone de culture générale : 70-95 facile, 35-69 moyen, 8-34 difficile. En dessous de 8 %, rejette comme trop obscur.',
      'quality_score mesure exactitude + clarté + intérêt ludique. Moins de 76 si la question ne mérite pas une vraie partie.',
      'topic_key identifie le FAIT testé afin de détecter les reformulations du même fait.',
      `Catégories autorisées : ${categories.join(', ')}.`,
      `DOSSIER FACTUEL GOOGLE SEARCH :\n${evidence.text}`,
      `QUESTIONS À FINALISER : ${JSON.stringify(blind)}`
    ].join('\n\n');

    const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
    const r=await fetch(endpoint,{method:'POST',headers:{'x-goog-api-key':process.env.GEMINI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0.01,topP:0.35,maxOutputTokens:18000,responseMimeType:'application/json',responseSchema:schema}})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok) return res.status(r.status===429?429:502).json({error:data?.error?.message||'Vérification Gemini impossible'});
    const text=outputText(data); if(!text) return res.status(502).json({error:'Réponse vide du vérificateur'});
    const parsed=JSON.parse(text);
    const approved=(parsed.reviews||[]).map(x=>normalizeReview(x,categories,evidence)).filter(Boolean);
    res.status(200).json({questions:approved,reviewedCount:questions.length,approvedCount:approved.length,model:MODEL,qualityControl:'grounded-blind-factory-review-v2',groundedSources:evidence.sources.length,searchQueries:evidence.queries.length});
  }catch(e){console.error(e);res.status(e.status===429?429:502).json({error:e.message||'Erreur du contrôleur de la fabrique'});}
};
