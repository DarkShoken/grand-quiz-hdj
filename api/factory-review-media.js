const MODEL=process.env.GEMINI_MODEL||'gemini-2.5-flash';
const clean=(v,m=300)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,m);
const norm=(v)=>clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/œ/g,'oe').replace(/[’']/g,' ').replace(/\b(le|la|les|un|une|des|du|de|d|l)\b/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const outputText=(d)=>(d?.candidates?.[0]?.content?.parts||[]).map(p=>typeof p?.text==='string'?p.text:'').join('').trim();
const difficulty=(p)=>p>=70?'Facile':p>=35?'Moyen':'Difficile';
function agrees(a,b){const x=norm(a),y=norm(b);if(!x||!y)return false;if(x===y)return true;const s=x.length<y.length?x:y,l=x.length<y.length?y:x;return s.length>=4&&l.includes(s);}
function allowedImageUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='upload.wikimedia.org'||u.hostname==='commons.wikimedia.org'||u.hostname.endsWith('.supabase.co'));}catch{return false;}}
module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Méthode non autorisée'});
  if(!process.env.GEMINI_API_KEY)return res.status(503).json({error:'GEMINI_API_KEY absente'});
  const q=req.body?.question||{};const src=clean(q?.media?.src,1000);const type=clean(q.type,30);
  if(!['image_mystery','location'].includes(type)||!allowedImageUrl(src))return res.status(400).json({error:'Question média invalide'});
  const proposed=[clean(q.answer,100),...(Array.isArray(q.accepted_answers)?q.accepted_answers.map(x=>clean(x,100)):[])].filter(Boolean);
  if(!proposed.length)return res.status(400).json({error:'Réponse proposée manquante'});
  try{
    const imageResponse=await fetch(src,{headers:{'User-Agent':'GrandQuizHDJ/1.0'}});
    if(!imageResponse.ok)return res.status(502).json({error:'Image inaccessible'});
    const mime=(imageResponse.headers.get('content-type')||'').split(';')[0];if(!['image/jpeg','image/png','image/webp'].includes(mime))return res.status(415).json({error:'Format image refusé'});
    const bytes=Buffer.from(await imageResponse.arrayBuffer());if(bytes.length>5*1024*1024)return res.status(413).json({error:'Image trop volumineuse'});
    const schema={type:'object',required:['approved','answer','accepted_answers','explanation','topic_key','expected_success_pct','quality_score'],properties:{approved:{type:'boolean'},answer:{type:'string'},accepted_answers:{type:'array',items:{type:'string'}},explanation:{type:'string'},topic_key:{type:'string'},expected_success_pct:{type:'number'},quality_score:{type:'integer'}}};
    const prompt=[
      'Tu es le vérificateur visuel indépendant d’un quiz français pour adultes. Tu ne connais PAS la réponse proposée par l’auteur.',
      `Type : ${type==='location'?'Où sommes-nous ?':'Image mystère'}.`,
      `Question affichée : ${clean(q.question,160)}`,
      'Identifie toi-même ce que montre réellement l’image. approved=true uniquement si l’image est suffisamment claire, si une réponse courte et unique est possible et si tu es très confiant.',
      'Pour location, donne la ville/le lieu demandé exactement au niveau de précision de la question. Pour image mystère, identifie le sujet demandé sans extrapoler.',
      'accepted_answers contient seulement des variantes strictement équivalentes en français. expected_success_pct estime la réussite d’un adulte de culture générale. Rejette une image ambiguë, générique ou insuffisamment identifiable.',
      'quality_score combine reconnaissance visuelle, clarté et intérêt ludique ; moins de 78 signifie rejet.'
    ].join('\n\n');
    const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
    const r=await fetch(endpoint,{method:'POST',headers:{'x-goog-api-key':process.env.GEMINI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt},{inline_data:{mime_type:mime,data:bytes.toString('base64')}}]}],generationConfig:{temperature:0,topP:0.35,maxOutputTokens:3000,responseMimeType:'application/json',responseSchema:schema}})});
    const data=await r.json().catch(()=>({}));if(!r.ok)return res.status(r.status===429?429:502).json({error:data?.error?.message||'Vérification visuelle impossible'});
    const parsed=JSON.parse(outputText(data)||'{}');const pct=Math.max(1,Math.min(99,Number(parsed.expected_success_pct)||0));const quality=Math.max(0,Math.min(100,Number(parsed.quality_score)||0));
    const independent=clean(parsed.answer,100);const agreement=proposed.some(x=>agrees(x,independent));
    const approved=parsed.approved===true&&agreement&&pct>=8&&quality>=78;
    if(!approved)return res.status(200).json({approved:false,independentAnswer:independent,agreement,quality_score:quality});
    const accepted=[independent,...(Array.isArray(parsed.accepted_answers)?parsed.accepted_answers:[])].map(x=>clean(x,100)).filter((x,i,a)=>x&&a.findIndex(y=>norm(y)===norm(x))===i).slice(0,8);
    res.status(200).json({approved:true,question:{category:clean(q.category,60),type,difficulty:difficulty(pct),expected_success_pct:pct,question:clean(q.question,160),options:[],answer:independent,accepted_answers:accepted,explanation:clean(parsed.explanation,260),topic_key:clean(parsed.topic_key,140),clues:[],media:q.media,source_evidence:Array.isArray(q.source_evidence)?q.source_evidence:[],quality_score:quality},model:MODEL,qualityControl:'blind-image-agreement-v1'});
  }catch(e){console.error(e);res.status(500).json({error:'Erreur de vérification média'});}
};
