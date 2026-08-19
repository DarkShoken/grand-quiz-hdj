#!/usr/bin/env python3
import argparse, hashlib, json, os, random, re, sys, time
from datetime import datetime, timezone
from urllib.parse import urlparse
import requests

SUPABASE_URL=os.getenv('SUPABASE_URL','https://rkuxwkqdgrlqhajqxdtr.supabase.co').rstrip('/')
SUPABASE_KEY=os.getenv('SUPABASE_ANON_KEY','sb_publishable_El_xyoQgJp6FddKYUWiY9w_VwTTVLEG')
FACTORY_TOKEN=os.getenv('FACTORY_TOKEN','')
QUIZ_BASE_URL=os.getenv('QUIZ_BASE_URL','https://grand-quiz-hdj.vercel.app').rstrip('/')
OLLAMA_URL=os.getenv('OLLAMA_URL','http://127.0.0.1:11434').rstrip('/')
OLLAMA_MODEL=os.getenv('OLLAMA_MODEL','qwen3:4b-instruct-2507-q4_K_M')
BATCH_SIZE=max(2,min(10,int(os.getenv('BATCH_SIZE','6'))))
SLEEP_SECONDS=max(5,int(os.getenv('SLEEP_SECONDS','30')))
TARGETS={'Facile':int(os.getenv('TARGET_EASY','100')),'Moyen':int(os.getenv('TARGET_MEDIUM','120')),'Difficile':int(os.getenv('TARGET_HARD','80'))}

CATEGORIES=[
'Animaux','Années 80, 90 & 2000','Arts & peinture','Cinéma & TV','Corps humain','Cuisine','Culture générale','Dessins animés','France','Géographie','Histoire','Insolite','Inventions & découvertes','Jeux vidéo','Langue française','Littérature','Logique & devinettes','Monde & cultures','Musique','Mythologie','Nature & environnement','Numérique','Provence','Sciences','Sport','Records du monde','Arbres','Plantes','Fruits','Astronomie','Arbre généalogique','Anglais','Automobile','Agriculture','Expressions françaises des régions','Architecture','BTP & travaux','Jeux olympiques','Célébrités'
]

TYPE_RATIOS={'mcq':.42,'truefalse':.07,'numeric':.06,'free':.10,'buzzer':.07,'intruder':.08,'estimation':.05,'progressive':.08,'image_mystery':.05,'location':.02}
MEDIA_CATEGORIES={'Animaux','Arts & peinture','Cinéma & TV','Dessins animés','France','Géographie','Monde & cultures','Nature & environnement','Provence','Arbres','Plantes','Fruits','Astronomie','Automobile','Agriculture','Architecture','BTP & travaux','Jeux olympiques','Célébrités'}
LOCATION_CATEGORIES={'France','Géographie','Monde & cultures','Provence','Architecture','Jeux olympiques'}
NUMERIC_WEAK={'Langue française','Littérature','Expressions françaises des régions','Anglais','Logique & devinettes'}

CATEGORY_RULES={
'Célébrités':'Uniquement œuvres, carrière et faits publics stables. Jamais rumeurs, vie privée, couple, fortune ou actualité mouvante.',
'Records du monde':'Uniquement record clairement défini et daté quand il peut évoluer.',
'Jeux olympiques':'Préciser l’édition ou l’année dès qu’un record, programme ou résultat peut dépendre du temps.',
'Expressions françaises des régions':'Expression réellement attestée ; éviter les attributions régionales discutables.',
'BTP & travaux':'Terminologie courante du bâtiment, matériaux, outils, métiers et principes techniques stables. Pas de conseil de sécurité hasardeux.',
'Architecture':'Bâtiments, styles, éléments architecturaux et architectes bien établis ; éviter les attributions contestées.',
'Numérique':'Éviter versions logicielles, prix, parts de marché et faits qui changent rapidement.'
}

session=requests.Session()
session.headers.update({'User-Agent':'GrandQuizHDJ-Factory/1.0'})

def norm(v):
    import unicodedata
    s=unicodedata.normalize('NFD',str(v or '')).encode('ascii','ignore').decode().lower().replace('œ','oe')
    return re.sub(r'[^a-z0-9]+',' ',s).strip()

def supabase_headers():
    return {'apikey':SUPABASE_KEY,'Authorization':f'Bearer {SUPABASE_KEY}','Content-Type':'application/json'}

def rpc(name,payload):
    r=session.post(f'{SUPABASE_URL}/rest/v1/rpc/{name}',headers=supabase_headers(),json=payload,timeout=45)
    r.raise_for_status(); return r.json()

def counts():
    rows=rpc('quiz_bank_counts',{})
    out={}
    for r in rows: out[(r['category'],r['difficulty'],r['type'])]=int(r['question_count'])
    return out

def existing_topics(category,limit=240):
    params={'select':'topic_key','category':f'eq.{category}','status':'eq.validated','disabled':'eq.false','limit':str(limit)}
    try:
        r=session.get(f'{SUPABASE_URL}/rest/v1/quiz_questions',headers=supabase_headers(),params=params,timeout=30);r.raise_for_status()
        return [x.get('topic_key','') for x in r.json() if x.get('topic_key')]
    except Exception:return []

def choose_slot(stock):
    slots=[]
    for c in CATEGORIES:
        for d,target in TARGETS.items():
            total=sum(stock.get((c,d,t),0) for t in TYPE_RATIOS)
            deficit=target-total
            if deficit>0: slots.append((deficit,c,d,target))
    if not slots:return None
    maxdef=max(x[0] for x in slots)
    candidates=[x for x in slots if x[0]>=maxdef-5]
    return random.choice(candidates)

def allowed_types(category):
    types=set(TYPE_RATIOS)
    if category not in MEDIA_CATEGORIES: types.discard('image_mystery')
    if category not in LOCATION_CATEGORIES: types.discard('location')
    if category in NUMERIC_WEAK: types.discard('numeric');types.discard('estimation')
    return types

def choose_type(stock,category,difficulty,target):
    choices=[]
    for t in allowed_types(category):
        desired=max(2,round(target*TYPE_RATIOS[t]))
        have=stock.get((category,difficulty,t),0)
        choices.append((have/max(1,desired),random.random(),t))
    choices.sort();return choices[0][2]

def qwen_schema():
    item={'type':'object','required':['id','category','type','question','options','answer','unit','accepted_answers','explanation','topic_key','clues','media_search'], 'properties':{
      'id':{'type':'string'},'category':{'type':'string'},'type':{'type':'string'},'question':{'type':'string'},'options':{'type':'array','items':{'type':'string'}},'answer':{'type':'string'},'unit':{'type':'string'},'accepted_answers':{'type':'array','items':{'type':'string'}},'explanation':{'type':'string'},'topic_key':{'type':'string'},'clues':{'type':'array','items':{'type':'string'}},'media_search':{'type':'string'}}}
    return {'type':'object','required':['questions'],'properties':{'questions':{'type':'array','items':item}}}

def generate_qwen(category,difficulty,qtype,count,topics):
    special=CATEGORY_RULES.get(category,'')
    type_rules={
      'mcq':'QCM : exactement 4 options homogènes et une seule correcte.',
      'intruder':'INTRUS : 4 éléments du même domaine ; trois partagent une propriété claire, un seul est l’intrus.',
      'truefalse':'VRAI/FAUX : énoncé totalement vrai ou totalement faux, sans nuance cachée.',
      'numeric':'NUMÉRIQUE : réponse exacte et stable, pas une moyenne ni une approximation.',
      'estimation':'ESTIMATION : valeur de référence exacte et stable, intéressante à estimer.',
      'free':'RÉPONSE LIBRE : réponse courte, unique ; accepted_answers uniquement variantes strictement équivalentes.',
      'buzzer':'BUZZER : question orale courte avec réponse unique et reconnaissable.',
      'progressive':'INDICES PROGRESSIFS : 4 indices vrais du plus difficile au plus évident, sans jamais écrire la réponse.',
      'image_mystery':'IMAGE MYSTÈRE : choisir un sujet visuellement identifiable sur Wikimedia Commons ; media_search doit être précis en anglais si utile.',
      'location':'OÙ SOMMES-NOUS : lieu/monument très identifiable visuellement ; réponse attendue au niveau ville ou lieu explicitement demandé.'
    }[qtype]
    prompt=f'''Tu es AUTEUR, pas vérificateur, d’un quiz français adulte. Propose {count} questions candidates.
Catégorie exacte : {category}. Difficulté visée : {difficulty}. Type exact : {qtype}.
{type_rules}
{special}
Chaque fait doit être stable et tu dois être réellement confiant. Évite actualité, opinions, superlatifs vagues, légendes, ambiguïtés et sujets arbitrairement obscurs.
Question <=130 caractères. Explication courte. topic_key décrit le fait testé et doit être différent des sujets déjà utilisés.
Pour les champs inutiles : options=[], clues=[], unit='', media_search=''. Pour image_mystery/location, renseigne media_search.
Sujets déjà présents à éviter : {json.dumps(topics[-180:],ensure_ascii=False)}'''
    payload={'model':OLLAMA_MODEL,'messages':[{'role':'user','content':prompt}],'stream':False,'format':qwen_schema(),'options':{'temperature':0.62,'top_p':0.82,'num_ctx':4096}}
    r=session.post(f'{OLLAMA_URL}/api/chat',json=payload,timeout=600);r.raise_for_status()
    content=r.json().get('message',{}).get('content','');data=json.loads(content)
    result=[]
    for i,q in enumerate(data.get('questions',[])):
        q['id']=q.get('id') or f'qwen-{int(time.time())}-{i}'
        q['category']=category;q['type']=qtype
        result.append(q)
    return result[:count]

def review_text(category,candidates):
    r=session.post(f'{QUIZ_BASE_URL}/api/factory-review',json={'categories':[category],'questions':candidates},timeout=180)
    r.raise_for_status();return r.json().get('questions',[])

def commons_image(search_term):
    params={'action':'query','format':'json','generator':'search','gsrsearch':search_term,'gsrnamespace':'6','gsrlimit':'10','prop':'imageinfo','iiprop':'url|mime|extmetadata','iiurlwidth':'900'}
    r=session.get('https://commons.wikimedia.org/w/api.php',params=params,timeout=45);r.raise_for_status()
    pages=list((r.json().get('query') or {}).get('pages',{}).values());random.shuffle(pages)
    for page in pages:
        info=(page.get('imageinfo') or [{}])[0];mime=info.get('mime','')
        if mime not in ('image/jpeg','image/png','image/webp'):continue
        src=info.get('thumburl') or info.get('url');
        if not src:continue
        meta=info.get('extmetadata') or {}
        license_name=((meta.get('LicenseShortName') or {}).get('value') or '')
        if not license_name:continue
        return {'src':src,'label':'Image mystère','source':'Wikimedia Commons','page':info.get('descriptionurl') or '', 'license':license_name,'artist':clean_html((meta.get('Artist') or {}).get('value',''))}
    return None

def clean_html(value):return re.sub(r'<[^>]+>',' ',str(value or '')).replace('&nbsp;',' ').strip()[:240]

def review_media(candidate):
    media=commons_image(candidate.get('media_search') or candidate.get('answer') or candidate.get('question'))
    if not media:return None
    q={**candidate,'media':media,'source_evidence':[{'source':'Wikimedia Commons','url':media.get('page',''),'license':media.get('license',''),'artist':media.get('artist','')} ]}
    r=session.post(f'{QUIZ_BASE_URL}/api/factory-review-media',json={'question':q},timeout=180);r.raise_for_status();data=r.json()
    return data.get('question') if data.get('approved') else None

def question_key(q):
    raw='|'.join([q.get('category',''),q.get('topic_key',''),q.get('type',''),norm(q.get('question',''))])
    return hashlib.sha256(raw.encode()).hexdigest()

def db_row(q,author_candidate=None):
    t=q['type'];options=q.get('options') or [];ans=q.get('answer','')
    if t in ('mcq','intruder'):
        idx=next((i for i,x in enumerate(options) if norm(x)==norm(ans)),-1);answer={'text':ans,'index':idx}
        if idx<0:return None
    elif t=='truefalse':answer={'value':norm(ans) in ('true','vrai')}
    elif t in ('numeric','estimation'):
        try:value=float(str(ans).replace(',','.'));value=int(value) if value.is_integer() else value
        except Exception:return None
        answer={'value':value,'unit':q.get('unit','')}
    else:answer={'text':ans}
    return {'question_key':question_key(q),'category':q['category'],'difficulty':q['difficulty'],'expected_success_pct':q.get('expected_success_pct'),'type':t,'question':q['question'],'options':options,'answer':answer,'accepted_answers':q.get('accepted_answers') or [],'explanation':q.get('explanation',''),'topic_key':q.get('topic_key',''),'clues':q.get('clues') or [],'media':q.get('media') or {},'source_evidence':q.get('source_evidence') or [],'author_model':OLLAMA_MODEL,'verifier_model':'gemini','quality_score':q.get('quality_score',80),'verification':{'pipeline':'qwen-local+gemini-blind','verified_at':datetime.now(timezone.utc).isoformat()}}

def ingest(rows):
    rows=[x for x in rows if x]
    if not rows:return 0
    return int(rpc('ingest_quiz_questions',{'p_token':FACTORY_TOKEN,'p_questions':rows}) or 0)

def one_batch():
    stock=counts();slot=choose_slot(stock)
    if not slot:
        print('Banque cible atteinte.');return 0
    deficit,category,difficulty,target=slot;qtype=choose_type(stock,category,difficulty,target)
    topics=existing_topics(category)
    print(f'→ {category} / {difficulty} / {qtype} · déficit {deficit}')
    candidates=generate_qwen(category,difficulty,qtype,BATCH_SIZE,topics)
    if not candidates:return 0
    reviewed=[]
    if qtype in ('image_mystery','location'):
        for c in candidates:
            try:
                q=review_media(c)
                if q: reviewed.append(q)
            except Exception as e: print('  média rejeté:',e)
    else:
        reviewed=review_text(category,candidates)
    rows=[db_row(q) for q in reviewed]
    added=ingest(rows)
    print(f'  Qwen {len(candidates)} → Gemini {len(reviewed)} validées → {added} nouvelles en banque')
    return added

def show_status():
    stock=counts();total=sum(stock.values());print(f'Total validé : {total}')
    for c in CATEGORIES:
        n=sum(v for (cat,d,t),v in stock.items() if cat==c)
        print(f'{c:38} {n:4d}/{sum(TARGETS.values())}')

def main():
    p=argparse.ArgumentParser();p.add_argument('--daemon',action='store_true');p.add_argument('--once',action='store_true');p.add_argument('--status',action='store_true');args=p.parse_args()
    if args.status:return show_status()
    if not FACTORY_TOKEN:sys.exit('FACTORY_TOKEN manquant dans /etc/grand-quiz-factory.env')
    while True:
        try:one_batch()
        except KeyboardInterrupt:return
        except Exception as e:print('ERREUR:',repr(e),flush=True)
        if not args.daemon:return
        time.sleep(SLEEP_SECONDS)

if __name__=='__main__':main()
