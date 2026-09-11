const MODELS = ['gemini-2.5-flash-lite','gemini-2.5-flash'];
const SUPABASE_URL = 'https://rkuxwkqdgrlqhajqxdtr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_El_xyoQgJp6FddKYUWiY9w_VwTTVLEG';
function text(v,max=220){return String(v??'').replace(/\s+/g,' ').trim().slice(0,max)}
function outputText(data){return (data?.candidates?.[0]?.content?.parts||[]).map(p=>typeof p?.text==='string'?p.text:'').join('').trim()}
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function rpc(name,body){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:SUPABASE_ANON_KEY,Authorization:`Bearer ${SUPABASE_ANON_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body||{})});
  const data=await r.json().catch(()=>null);return {ok:r.ok,status:r.status,data};
}
module.exports=async function handler(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'GET only'});
 if(!process.env.GEMINI_API_KEY)return res.status(503).json({error:'GEMINI_API_KEY missing'});
 const offset=Math.max(0,parseInt(req.query?.offset||'0',10)||0);const limit=Math.min(50,Math.max(1,parseInt(req.query?.limit||'50',10)||50));
 try{
  const read=await rpc('gq26_calibration_batch',{p_offset:offset,p_limit:limit});
  const items=read.data;if(!read.ok||!Array.isArray(items))return res.status(502).json({error:'batch read failed',status:read.status});
  if(!items.length)return res.status(200).json({model:null,offset,count:0,stored:0,results:[]});
  const qs=items.map(q=>({id:text(q.id,80),category:text(q.category,80),question:text(q.question,180),options:Array.isArray(q.options)?q.options.slice(0,4).map(x=>text(x,100)):[]}));
  const schema={type:'object',required:['results'],properties:{results:{type:'array',items:{type:'object',required:['id','successRate'],properties:{id:{type:'string'},successRate:{type:'integer'}}}}}};
  const prompt=['Tu calibres uniquement la difficulté de QCM pour un hôpital de jour adulte en France.','Public: adultes avec niveaux de culture générale très hétérogènes. Les 4 choix sont visibles.','Pour chaque question, estime successRate = pourcentage entier de patients qui répondraient correctement dans les conditions réelles du jeu.','Ne juge pas la qualité rédactionnelle, ne réécris rien et ne supprime aucune question.','Utilise tout l’intervalle 0-100. Une réponse quasi évidente avec les choix doit être >=90.','Une connaissance courante mais pas immédiate est souvent 75-89. Une connaissance plus précise mais accessible est souvent 55-74.','Sous 55 = très difficile pour ce public et doit être repérée comme telle.','Réponds à chaque id exactement une fois, dans le même ordre.',JSON.stringify(qs)].join('\n');
  const body=JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0,topP:0.2,maxOutputTokens:6500,responseMimeType:'application/json',responseSchema:schema}});
  let lastError='Gemini unavailable';
  for(const model of MODELS){
    for(let attempt=0;attempt<2;attempt++){
      const gr=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',headers:{'x-goog-api-key':process.env.GEMINI_API_KEY,'Content-Type':'application/json'},body});
      const data=await gr.json().catch(()=>({}));
      if(gr.ok){
        const raw=outputText(data);if(!raw){lastError='empty model output';continue;}
        const parsed=JSON.parse(raw);const byId=new Map((parsed.results||[]).map(x=>[String(x.id),Math.max(0,Math.min(100,Math.round(Number(x.successRate))))]));
        const results=qs.map(q=>({id:q.id,successRate:byId.has(q.id)?byId.get(q.id):null}));
        if(results.some(x=>x.successRate===null)){lastError='incomplete model output';continue;}
        const store=await rpc('gq26_store_calibration',{p_results:results,p_model:model});
        if(!store.ok)return res.status(502).json({error:'calibration store failed',status:store.status});
        return res.status(200).json({model,offset,count:results.length,stored:Number(store.data)||0,results});
      }
      lastError=data?.error?.message||`Gemini HTTP ${gr.status}`;
      if(![429,500,502,503].includes(gr.status)) break;
      await sleep(700*(attempt+1));
    }
  }
  return res.status(503).json({error:lastError,models:MODELS});
 }catch(e){console.error(e);return res.status(500).json({error:'calibration failed'})}
};
