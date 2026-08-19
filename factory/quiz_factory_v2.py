#!/usr/bin/env python3
import argparse, base64, hashlib, json, os, random, re, sys, time, unicodedata
from datetime import datetime, timezone
import requests

SUPABASE_URL = os.getenv('SUPABASE_URL', 'https://rkuxwkqdgrlqhajqxdtr.supabase.co').rstrip('/')
SUPABASE_KEY = os.getenv('SUPABASE_ANON_KEY', 'sb_publishable_El_xyoQgJp6FddKYUWiY9w_VwTTVLEG')
FACTORY_TOKEN = os.getenv('FACTORY_TOKEN', '')
OLLAMA_URL = os.getenv('OLLAMA_URL', 'http://127.0.0.1:11434').rstrip('/')
OLLAMA_MODEL = os.getenv('OLLAMA_MODEL', 'qwen3:4b-instruct-2507-q4_K_M')
LOCAL_REVIEW_MODEL = os.getenv('LOCAL_REVIEW_MODEL', 'gemma3:4b')
GROQ_API_KEY = os.getenv('GROQ_API_KEY', '')
GROQ_RESEARCH_MODEL = os.getenv('GROQ_RESEARCH_MODEL', 'groq/compound')
GROQ_REVIEW_MODEL = os.getenv('GROQ_REVIEW_MODEL', 'openai/gpt-oss-120b')
BATCH_SIZE = max(2, min(8, int(os.getenv('BATCH_SIZE', '6'))))
SLEEP_SECONDS = max(15, int(os.getenv('SLEEP_SECONDS', '45')))
GROQ_COOLDOWN_SECONDS = max(60, int(os.getenv('GROQ_COOLDOWN_SECONDS', '900')))
TARGETS = {
    'Facile': int(os.getenv('TARGET_EASY', '100')),
    'Moyen': int(os.getenv('TARGET_MEDIUM', '120')),
    'Difficile': int(os.getenv('TARGET_HARD', '80')),
}

CATEGORIES = [
    'Animaux','Années 80, 90 & 2000','Arts & peinture','Cinéma & TV','Corps humain','Cuisine',
    'Culture générale','Dessins animés','France','Géographie','Histoire','Insolite',
    'Inventions & découvertes','Jeux vidéo','Langue française','Littérature','Logique & devinettes',
    'Monde & cultures','Musique','Mythologie','Nature & environnement','Numérique','Provence','Sciences',
    'Sport','Records du monde','Arbres','Plantes','Fruits','Astronomie','Arbre généalogique','Anglais',
    'Automobile','Agriculture','Expressions françaises des régions','Architecture','BTP & travaux',
    'Jeux olympiques','Célébrités'
]

TYPE_RATIOS = {
    'mcq': .42, 'truefalse': .07, 'numeric': .06, 'free': .10, 'buzzer': .07,
    'intruder': .08, 'estimation': .05, 'progressive': .08, 'image_mystery': .05, 'location': .02,
}
MEDIA_CATEGORIES = {
    'Animaux','Arts & peinture','Cinéma & TV','Dessins animés','France','Géographie','Monde & cultures',
    'Nature & environnement','Provence','Arbres','Plantes','Fruits','Astronomie','Automobile','Agriculture',
    'Architecture','BTP & travaux','Jeux olympiques','Célébrités'
}
LOCATION_CATEGORIES = {'France','Géographie','Monde & cultures','Provence','Architecture','Jeux olympiques'}
NUMERIC_WEAK = {'Langue française','Littérature','Expressions françaises des régions','Anglais','Logique & devinettes'}

CATEGORY_RULES = {
    'Célébrités': 'Uniquement œuvres, carrière et faits publics stables. Jamais rumeurs, vie privée, couple, fortune ou actualité mouvante.',
    'Records du monde': 'Uniquement record clairement défini et daté quand il peut évoluer.',
    'Jeux olympiques': 'Préciser l’édition ou l’année dès qu’un record, programme ou résultat peut dépendre du temps.',
    'Expressions françaises des régions': 'Expression réellement attestée ; éviter les attributions régionales discutables.',
    'BTP & travaux': 'Terminologie courante du bâtiment, matériaux, outils, métiers et principes techniques stables. Pas de conseil de sécurité hasardeux.',
    'Architecture': 'Bâtiments, styles, éléments architecturaux et architectes bien établis ; éviter les attributions contestées.',
    'Numérique': 'Éviter versions logicielles, prix, parts de marché et faits qui changent rapidement.',
}

session = requests.Session()
session.headers.update({'User-Agent': 'GrandQuizHDJ-Factory/2.0'})
groq_disabled_until = 0.0

def norm(v):
    s = unicodedata.normalize('NFD', str(v or '')).encode('ascii', 'ignore').decode().lower().replace('œ', 'oe')
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()

def supabase_headers():
    return {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}', 'Content-Type': 'application/json'}

def rpc(name, payload):
    r = session.post(f'{SUPABASE_URL}/rest/v1/rpc/{name}', headers=supabase_headers(), json=payload, timeout=45)
    r.raise_for_status()
    return r.json()

def counts():
    rows = rpc('quiz_bank_counts', {})
    return {(r['category'], r['difficulty'], r['type']): int(r['question_count']) for r in rows}

def existing_topics(category, limit=240):
    params = {'select': 'topic_key', 'category': f'eq.{category}', 'status': 'eq.validated', 'disabled': 'eq.false', 'limit': str(limit)}
    try:
        r = session.get(f'{SUPABASE_URL}/rest/v1/quiz_questions', headers=supabase_headers(), params=params, timeout=30)
        r.raise_for_status()
        return [x.get('topic_key', '') for x in r.json() if x.get('topic_key')]
    except Exception:
        return []

def choose_slot(stock):
    slots = []
    for category in CATEGORIES:
        for difficulty, target in TARGETS.items():
            total = sum(stock.get((category, difficulty, qtype), 0) for qtype in TYPE_RATIOS)
            deficit = target - total
            if deficit > 0:
                slots.append((deficit, category, difficulty, target))
    if not slots:
        return None
    max_deficit = max(x[0] for x in slots)
    return random.choice([x for x in slots if x[0] >= max_deficit - 5])

def allowed_types(category):
    types = set(TYPE_RATIOS)
    if category not in MEDIA_CATEGORIES:
        types.discard('image_mystery')
    if category not in LOCATION_CATEGORIES:
        types.discard('location')
    if category in NUMERIC_WEAK:
        types.discard('numeric')
        types.discard('estimation')
    return types

def choose_type(stock, category, difficulty, target):
    choices = []
    for qtype in allowed_types(category):
        desired = max(2, round(target * TYPE_RATIOS[qtype]))
        have = stock.get((category, difficulty, qtype), 0)
        choices.append((have / max(1, desired), random.random(), qtype))
    choices.sort()
    return choices[0][2]

def qwen_schema():
    item = {
        'type': 'object',
        'required': ['id','category','type','question','options','answer','unit','accepted_answers','explanation','topic_key','clues','media_search'],
        'properties': {
            'id': {'type':'string'}, 'category': {'type':'string'}, 'type': {'type':'string'},
            'question': {'type':'string'}, 'options': {'type':'array','items':{'type':'string'}},
            'answer': {'type':'string'}, 'unit': {'type':'string'},
            'accepted_answers': {'type':'array','items':{'type':'string'}},
            'explanation': {'type':'string'}, 'topic_key': {'type':'string'},
            'clues': {'type':'array','items':{'type':'string'}}, 'media_search': {'type':'string'},
        }
    }
    return {'type':'object','required':['questions'],'properties':{'questions':{'type':'array','items':item}}}

def generate_qwen(category, difficulty, qtype, count, topics):
    special = CATEGORY_RULES.get(category, '')
    type_rules = {
        'mcq': 'QCM : exactement 4 options homogènes et une seule correcte.',
        'intruder': 'INTRUS : 4 éléments du même domaine ; trois partagent une propriété claire, un seul est l’intrus.',
        'truefalse': 'VRAI/FAUX : énoncé totalement vrai ou totalement faux, sans nuance cachée.',
        'numeric': 'NUMÉRIQUE : réponse exacte et stable, pas une moyenne ni une approximation.',
        'estimation': 'ESTIMATION : valeur de référence exacte et stable, intéressante à estimer.',
        'free': 'RÉPONSE LIBRE : réponse courte, unique ; accepted_answers uniquement variantes strictement équivalentes.',
        'buzzer': 'BUZZER : question orale courte avec réponse unique et reconnaissable.',
        'progressive': 'INDICES PROGRESSIFS : exactement 4 ou 5 indices du plus difficile au plus évident. Le premier doit être indirect et difficile. Aucun indice ne doit contenir la réponse ni simplement paraphraser la question.',
        'image_mystery': 'IMAGE MYSTÈRE : sujet visuellement identifiable sur Wikimedia Commons ; media_search précis.',
        'location': 'OÙ SOMMES-NOUS : lieu/monument très identifiable visuellement ; préciser dans la question si la réponse attendue est la ville, le pays ou le monument.',
    }[qtype]
    prompt = f"""Tu es AUTEUR de propositions pour un quiz français adulte. Propose {count} questions candidates.
Catégorie exacte : {category}. Difficulté visée : {difficulty}. Type exact : {qtype}.
{type_rules}
{special}
Tu n'es PAS l'autorité finale sur la réponse : un autre système cherchera des sources et pourra rejeter tes propositions.
Privilégie les faits stables, intéressants et documentables. Évite actualité, opinions, superlatifs vagues, légendes et sujets arbitrairement obscurs.
Question <=130 caractères. Explication courte. topic_key décrit le fait testé.
Pour les champs inutiles : options=[], clues=[], unit='', media_search=''.
Sujets déjà présents à éviter : {json.dumps(topics[-180:], ensure_ascii=False)}"""
    payload = {
        'model': OLLAMA_MODEL,
        'messages': [{'role':'user','content':prompt}],
        'stream': False,
        'format': qwen_schema(),
        'options': {'temperature':0.62,'top_p':0.82,'num_ctx':4096},
    }
    r = session.post(f'{OLLAMA_URL}/api/chat', json=payload, timeout=600)
    r.raise_for_status()
    data = json.loads(r.json().get('message',{}).get('content',''))
    result = []
    for i, q in enumerate(data.get('questions', [])):
        q['id'] = q.get('id') or f'qwen-{int(time.time())}-{i}'
        q['category'] = category
        q['type'] = qtype
        result.append(q)
    return result[:count]

def blind_candidates(candidates):
    return [{
        'id': q.get('id',''), 'category': q.get('category',''), 'type': q.get('type',''),
        'question': q.get('question',''), 'options': q.get('options') or [],
        'unit': q.get('unit',''), 'clues': q.get('clues') or []
    } for q in candidates]

def groq_headers():
    return {'Authorization': f'Bearer {GROQ_API_KEY}', 'Content-Type': 'application/json', 'Groq-Model-Version': 'latest'}

def mark_groq_cooldown(response=None):
    global groq_disabled_until
    wait = GROQ_COOLDOWN_SECONDS
    if response is not None:
        try:
            wait = max(wait, int(response.headers.get('retry-after','0') or 0))
        except Exception:
            pass
    groq_disabled_until = time.time() + wait
    print(f'  Groq indisponible/quota atteint → secours local pendant ~{wait//60} min', flush=True)

def groq_available():
    return bool(GROQ_API_KEY) and time.time() >= groq_disabled_until

def groq_research(candidates):
    blind = blind_candidates(candidates)
    prompt = """Tu es documentaliste fact-checker pour un quiz français adulte.
Les réponses de l'auteur sont volontairement cachées. Recherche sur le Web pour résoudre chaque question indépendamment.
Pour chaque ID : décide si le fait est stable et non ambigu, donne la réponse indépendante, et cite des sources fiables.
Pour QCM/intrus, vérifie que les autres options sont fausses dans le cadre exact.
Pour progressive, vérifie chaque indice et signale ceux qui révèlent trop vite la réponse.
REJETER si plusieurs réponses sont défendables, si les sources se contredisent, si le fait est mouvant ou si tu n'as pas de preuve nette.
Privilégie sources officielles, institutionnelles, encyclopédiques reconnues, musées, universités, fédérations ou documentation technique.
Retourne un dossier factuel clair par ID, avec les URLs/citations utilisées.
QUESTIONS :
""" + json.dumps(blind, ensure_ascii=False)
    payload = {
        'model': GROQ_RESEARCH_MODEL,
        'messages': [{'role':'user','content':prompt}],
        'compound_custom': {'tools': {'enabled_tools': ['web_search','visit_website']}},
        'temperature': 0,
        'max_completion_tokens': 12000,
    }
    r = session.post('https://api.groq.com/openai/v1/chat/completions', headers=groq_headers(), json=payload, timeout=180)
    if r.status_code == 429:
        mark_groq_cooldown(r)
        raise RuntimeError('groq_quota')
    r.raise_for_status()
    data = r.json()
    msg = data.get('choices',[{}])[0].get('message',{})
    content = msg.get('content','')
    sources = []
    for tool in msg.get('executed_tools') or []:
        for sr in tool.get('search_results') or []:
            url = sr.get('url') or sr.get('link')
            if url and not any(x.get('url') == url for x in sources):
                sources.append({'source':'Groq web search','title':str(sr.get('title') or '')[:180], 'url':url})
    return {'text': content, 'sources': sources[:24], 'provider':'groq-compound'}

def review_schema():
    item = {
        'type':'object',
        'additionalProperties': False,
        'required':['id','approved','category','type','question','options','answer','unit','accepted_answers','explanation','topic_key','clues','expected_success_pct','quality_score'],
        'properties': {
            'id':{'type':'string'}, 'approved':{'type':'boolean'}, 'category':{'type':'string'},
            'type':{'type':'string','enum':['mcq','truefalse','numeric','free','buzzer','intruder','estimation','progressive']},
            'question':{'type':'string'}, 'options':{'type':'array','items':{'type':'string'}},
            'answer':{'type':'string'}, 'unit':{'type':'string'},
            'accepted_answers':{'type':'array','items':{'type':'string'}},
            'explanation':{'type':'string'}, 'topic_key':{'type':'string'},
            'clues':{'type':'array','items':{'type':'string'}},
            'expected_success_pct':{'type':'number'}, 'quality_score':{'type':'integer'},
        }
    }
    return {'type':'object','additionalProperties':False,'required':['reviews'],'properties':{'reviews':{'type':'array','items':item}}}

def normalize_review(raw, category, evidence):
    if not raw or raw.get('approved') is not True:
        return None
    qtype = raw.get('type')
    if qtype not in {'mcq','truefalse','numeric','free','buzzer','intruder','estimation','progressive'}:
        return None
    if raw.get('category') != category:
        return None
    pct = max(1, min(99, float(raw.get('expected_success_pct') or 0)))
    quality = max(0, min(100, int(raw.get('quality_score') or 0)))
    if pct < 8 or quality < 76:
        return None
    difficulty = 'Facile' if pct >= 70 else 'Moyen' if pct >= 35 else 'Difficile'
    question = str(raw.get('question') or '').strip()[:150]
    explanation = str(raw.get('explanation') or '').strip()[:260]
    topic_key = str(raw.get('topic_key') or '').strip()[:140]
    if len(question) < 10 or not explanation or not topic_key:
        return None
    base = {
        'id': str(raw.get('id') or '')[:120], 'category': category, 'type': qtype, 'question': question,
        'difficulty': difficulty, 'expected_success_pct': pct, 'explanation': explanation, 'topic_key': topic_key,
        'quality_score': quality, 'source_evidence': evidence.get('sources') or [],
        'verification_evidence': {'provider': evidence.get('provider',''), 'grounded': bool(evidence.get('text'))},
        'accepted_answers': [str(x).strip()[:100] for x in (raw.get('accepted_answers') or []) if str(x).strip()][:8],
        'clues': [str(x).strip()[:180] for x in (raw.get('clues') or []) if str(x).strip()][:5],
    }
    options = [str(x).strip()[:70] for x in (raw.get('options') or []) if str(x).strip()][:4]
    answer = str(raw.get('answer') or '').strip()[:100]
    if qtype in {'mcq','intruder'}:
        if len(options) != 4 or len({norm(x) for x in options}) != 4:
            return None
        match = next((x for x in options if norm(x) == norm(answer)), None)
        if not match:
            return None
        base.update(options=options, answer=match, unit='')
    elif qtype == 'truefalse':
        a = norm(answer)
        if a not in {'true','false','vrai','faux'}:
            return None
        base.update(options=[], answer='true' if a in {'true','vrai'} else 'false', unit='')
    elif qtype in {'numeric','estimation'}:
        try:
            float(answer.replace(',','.'))
        except Exception:
            return None
        base.update(options=[], answer=answer.replace(',','.'), unit=str(raw.get('unit') or '')[:40])
    else:
        if not answer:
            return None
        accepted = [answer] + base['accepted_answers']
        uniq = []
        for x in accepted:
            if norm(x) and not any(norm(y) == norm(x) for y in uniq):
                uniq.append(x)
        base.update(options=[], answer=answer, accepted_answers=uniq[:8], unit='')
        if qtype == 'progressive':
            clues = base['clues']
            if len(clues) not in {4,5}:
                return None
            if any(norm(answer) in norm(c) for c in clues if len(norm(answer)) >= 4):
                return None
    return base

def groq_finalize(category, candidates, evidence):
    prompt = """Tu es le rédacteur en chef FINAL d'un quiz français pour adultes.
Tu reçois des questions sans les réponses de l'auteur et un DOSSIER FACTUEL indépendant issu d'une recherche Web.
N'utilise QUE ce dossier pour décider. approved=true uniquement si une réponse unique est explicitement soutenue.
Refuse les questions ambiguës, mouvantes, trop obscures ou mal sourcées.
Pour QCM/intrus : exactement 4 options, une seule vraie ; answer recopie la bonne option.
Pour truefalse : answer=true ou false. Pour numeric/estimation : valeur stable exacte.
Pour free/buzzer : réponse courte unique et variantes strictement équivalentes.
Pour progressive : réécris 4 ou 5 indices vrais, non redondants, du plus difficile au plus évident. Le premier est indirect ; aucun indice ne contient la réponse ni ne paraphrase simplement la question.
Calibre expected_success_pct : 70-95 Facile, 35-69 Moyen, 8-34 Difficile ; <8 => rejeter.
quality_score <76 si la question ne mérite pas une vraie partie.
""" + "\nDOSSIER FACTUEL:\n" + evidence['text'] + "\nQUESTIONS:\n" + json.dumps(blind_candidates(candidates), ensure_ascii=False)
    schema = review_schema()
    payload = {
        'model': GROQ_REVIEW_MODEL,
        'messages': [{'role':'user','content':prompt}],
        'temperature': 0,
        'reasoning_effort': 'high',
        'include_reasoning': False,
        'max_completion_tokens': 12000,
        'response_format': {'type':'json_schema','json_schema':{'name':'quiz_reviews','strict':True,'schema':schema}},
    }
    r = session.post('https://api.groq.com/openai/v1/chat/completions', headers=groq_headers(), json=payload, timeout=180)
    if r.status_code == 429:
        mark_groq_cooldown(r)
        raise RuntimeError('groq_quota')
    r.raise_for_status()
    content = r.json().get('choices',[{}])[0].get('message',{}).get('content','')
    parsed = json.loads(content)
    return [q for q in (normalize_review(x, category, evidence) for x in parsed.get('reviews',[])) if q]

def wiki_evidence(candidates):
    pieces, sources = [], []
    for q in blind_candidates(candidates):
        search_text = q['question']
        if q['options']:
            search_text += ' ' + ' '.join(q['options'])
        params = {'action':'query','format':'json','list':'search','srsearch':search_text,'srlimit':'3','utf8':'1'}
        try:
            r = session.get('https://fr.wikipedia.org/w/api.php', params=params, timeout=30)
            r.raise_for_status()
            results = (r.json().get('query') or {}).get('search') or []
        except Exception:
            results = []
        docs = []
        for item in results[:2]:
            title = item.get('title','')
            try:
                rr = session.get('https://fr.wikipedia.org/w/api.php', params={
                    'action':'query','format':'json','prop':'extracts|info','inprop':'url','explaintext':'1','exintro':'1','titles':title
                }, timeout=30)
                rr.raise_for_status()
                page = next(iter((rr.json().get('query') or {}).get('pages',{}).values()), {})
                extract = str(page.get('extract') or '')[:3500]
                url = page.get('fullurl') or f'https://fr.wikipedia.org/wiki/{title.replace(" ","_")}'
                if extract:
                    docs.append({'title':title,'url':url,'extract':extract})
                    if not any(s['url'] == url for s in sources):
                        sources.append({'source':'Wikipédia','title':title,'url':url})
            except Exception:
                pass
        pieces.append({'id':q['id'],'documents':docs})
    return {'text':json.dumps(pieces, ensure_ascii=False), 'sources':sources[:24], 'provider':'wikipedia-local'}

def local_finalize(category, candidates, evidence):
    prompt = """Tu es un vérificateur indépendant. Les réponses de l'auteur sont cachées.
Utilise UNIQUEMENT les documents fournis. Rejette toute question dont la réponse n'est pas explicitement démontrée, toute ambiguïté et toute information mouvante.
Pour les indices progressifs, fournis exactement 4 ou 5 indices vrais du plus difficile au plus évident, sans donner la réponse.
Retourne uniquement le JSON conforme au schéma.
DOSSIER:
""" + evidence['text'] + "\nQUESTIONS:\n" + json.dumps(blind_candidates(candidates), ensure_ascii=False)
    payload = {
        'model': LOCAL_REVIEW_MODEL,
        'messages':[{'role':'user','content':prompt}],
        'stream':False,
        'format':review_schema(),
        'options':{'temperature':0,'num_ctx':8192},
    }
    r = session.post(f'{OLLAMA_URL}/api/chat', json=payload, timeout=900)
    r.raise_for_status()
    parsed = json.loads(r.json().get('message',{}).get('content',''))
    return [q for q in (normalize_review(x, category, evidence) for x in parsed.get('reviews',[])) if q]

def review_text(category, candidates):
    if groq_available():
        try:
            evidence = groq_research(candidates)
            reviewed = groq_finalize(category, candidates, evidence)
            print(f'  Vérification Groq : {len(reviewed)}/{len(candidates)} retenues · {len(evidence["sources"])} sources', flush=True)
            return reviewed
        except Exception as e:
            if str(e) != 'groq_quota':
                print(f'  Groq en erreur ({e}) → secours local', flush=True)
    evidence = wiki_evidence(candidates)
    reviewed = local_finalize(category, candidates, evidence)
    print(f'  Vérification locale Gemma+Wikipédia : {len(reviewed)}/{len(candidates)} retenues · {len(evidence["sources"])} sources', flush=True)
    return reviewed

def commons_image(search_term):
    params = {
        'action':'query','format':'json','generator':'search','gsrsearch':search_term,'gsrnamespace':'6','gsrlimit':'10',
        'prop':'imageinfo','iiprop':'url|mime|extmetadata','iiurlwidth':'900'
    }
    r = session.get('https://commons.wikimedia.org/w/api.php', params=params, timeout=45)
    r.raise_for_status()
    pages = list((r.json().get('query') or {}).get('pages',{}).values())
    random.shuffle(pages)
    for page in pages:
        info = (page.get('imageinfo') or [{}])[0]
        if info.get('mime','') not in ('image/jpeg','image/png','image/webp'):
            continue
        src = info.get('thumburl') or info.get('url')
        meta = info.get('extmetadata') or {}
        license_name = ((meta.get('LicenseShortName') or {}).get('value') or '')
        if not src or not license_name:
            continue
        return {
            'src':src, 'label':'Image mystère', 'source':'Wikimedia Commons',
            'page':info.get('descriptionurl') or '', 'license':license_name,
            'artist':re.sub(r'<[^>]+>',' ',str((meta.get('Artist') or {}).get('value',''))).strip()[:240],
            'description':re.sub(r'<[^>]+>',' ',str((meta.get('ImageDescription') or {}).get('value',''))).strip()[:500],
        }
    return None

def local_vision_answer(candidate, media):
    img = session.get(media['src'], timeout=60)
    img.raise_for_status()
    image_b64 = base64.b64encode(img.content).decode()
    prompt = f"""Tu vérifies une question visuelle de quiz. La réponse proposée par l'auteur est cachée.
Observe uniquement l'image. Question : {candidate.get('question','')}
Type : {candidate.get('type','')}
Donne la réponse que l'image permet réellement d'identifier. Si l'image est ambiguë, inutilisable ou ne permet pas une réponse unique, approved=false.
Retourne JSON avec approved, answer, explanation."""
    schema = {
        'type':'object','required':['approved','answer','explanation'],
        'properties':{'approved':{'type':'boolean'},'answer':{'type':'string'},'explanation':{'type':'string'}}
    }
    r = session.post(f'{OLLAMA_URL}/api/chat', json={
        'model':LOCAL_REVIEW_MODEL,'messages':[{'role':'user','content':prompt,'images':[image_b64]}],
        'stream':False,'format':schema,'options':{'temperature':0,'num_ctx':4096}
    }, timeout=900)
    r.raise_for_status()
    return json.loads(r.json().get('message',{}).get('content',''))

def review_media(candidate):
    media = commons_image(candidate.get('media_search') or candidate.get('question'))
    if not media:
        return None
    vision = local_vision_answer(candidate, media)
    if not vision.get('approved') or not str(vision.get('answer') or '').strip():
        return None
    evidence = {
        'text': json.dumps({
            'question': blind_candidates([candidate])[0],
            'independent_visual_answer': vision['answer'],
            'wikimedia_description': media.get('description',''),
            'wikimedia_page': media.get('page',''),
        }, ensure_ascii=False),
        'sources':[{'source':'Wikimedia Commons','title':media.get('description','')[:180],'url':media.get('page','')}],
        'provider':'gemma3-vision+wikimedia',
    }
    if groq_available():
        try:
            reviewed = groq_finalize(candidate['category'], [candidate], evidence)
        except Exception:
            reviewed = []
    else:
        reviewed = local_finalize(candidate['category'], [candidate], evidence)
    if not reviewed:
        return None
    q = reviewed[0]
    q['media'] = media
    q['source_evidence'] = evidence['sources']
    return q

def question_key(q):
    raw = '|'.join([q.get('category',''), q.get('topic_key',''), q.get('type',''), norm(q.get('question',''))])
    return hashlib.sha256(raw.encode()).hexdigest()

def db_row(q):
    qtype, options, ans = q['type'], q.get('options') or [], q.get('answer','')
    if qtype in ('mcq','intruder'):
        idx = next((i for i,x in enumerate(options) if norm(x)==norm(ans)), -1)
        if idx < 0:
            return None
        answer = {'text':ans,'index':idx}
    elif qtype == 'truefalse':
        answer = {'value': norm(ans) in ('true','vrai')}
    elif qtype in ('numeric','estimation'):
        try:
            value = float(str(ans).replace(',','.'))
            value = int(value) if value.is_integer() else value
        except Exception:
            return None
        answer = {'value':value,'unit':q.get('unit','')}
    else:
        answer = {'text':ans}
    return {
        'question_key':question_key(q),'category':q['category'],'difficulty':q['difficulty'],
        'expected_success_pct':q.get('expected_success_pct'),'type':qtype,'question':q['question'],
        'options':options,'answer':answer,'accepted_answers':q.get('accepted_answers') or [],
        'explanation':q.get('explanation',''),'topic_key':q.get('topic_key',''),'clues':q.get('clues') or [],
        'media':q.get('media') or {},'source_evidence':q.get('source_evidence') or [],
        'author_model':OLLAMA_MODEL,'verifier_model':q.get('verification_evidence',{}).get('provider') or LOCAL_REVIEW_MODEL,
        'quality_score':q.get('quality_score',80),
        'verification': {
            'pipeline':'qwen-local+groq-or-local-grounded-v3',
            'verified_at':datetime.now(timezone.utc).isoformat(),
            **(q.get('verification_evidence') or {}),
        }
    }

def ingest(rows):
    rows = [x for x in rows if x]
    if not rows:
        return 0
    return int(rpc('ingest_quiz_questions', {'p_token':FACTORY_TOKEN,'p_questions':rows}) or 0)

def one_batch():
    stock = counts()
    slot = choose_slot(stock)
    if not slot:
        print('Banque cible atteinte.')
        return 0
    deficit, category, difficulty, target = slot
    qtype = choose_type(stock, category, difficulty, target)
    print(f'→ {category} / {difficulty} / {qtype} · déficit {deficit}', flush=True)
    candidates = generate_qwen(category, difficulty, qtype, BATCH_SIZE, existing_topics(category))
    if not candidates:
        return 0
    reviewed = []
    if qtype in ('image_mystery','location'):
        for c in candidates:
            try:
                q = review_media(c)
                if q:
                    reviewed.append(q)
            except Exception as e:
                print(f'  média rejeté: {e}', flush=True)
    else:
        reviewed = review_text(category, candidates)
    added = ingest([db_row(q) for q in reviewed])
    print(f'  Qwen {len(candidates)} → {len(reviewed)} validées → {added} nouvelles en banque', flush=True)
    return added

def show_status():
    stock = counts()
    print(f'Total validé : {sum(stock.values())}')
    for c in CATEGORIES:
        n = sum(v for (cat, d, t), v in stock.items() if cat == c)
        print(f'{c:38} {n:4d}/{sum(TARGETS.values())}')

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--daemon', action='store_true')
    p.add_argument('--once', action='store_true')
    p.add_argument('--status', action='store_true')
    args = p.parse_args()
    if args.status:
        return show_status()
    if not FACTORY_TOKEN:
        sys.exit('FACTORY_TOKEN manquant dans /etc/grand-quiz-factory.env')
    while True:
        try:
            one_batch()
        except KeyboardInterrupt:
            return
        except Exception as e:
            print('ERREUR:', repr(e), flush=True)
        if not args.daemon:
            return
        time.sleep(SLEEP_SECONDS)

if __name__ == '__main__':
    main()
