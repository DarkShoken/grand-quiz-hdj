#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Lance ce script avec sudo." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR=/opt/grand-quiz-factory
ENV_FILE=/etc/grand-quiz-factory.env
SERVICE_FILE=/etc/systemd/system/grand-quiz-factory.service
AUTHOR_MODEL=qwen3:4b-instruct-2507-q4_K_M
REVIEW_MODEL=gemma3:4b

apt-get update
apt-get install -y curl ca-certificates python3 python3-venv python3-pip

if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi
systemctl enable --now ollama

sudo -u "${SUDO_USER:-root}" ollama pull "$AUTHOR_MODEL" || ollama pull "$AUTHOR_MODEL"
sudo -u "${SUDO_USER:-root}" ollama pull "$REVIEW_MODEL" || ollama pull "$REVIEW_MODEL"

mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/quiz_factory_v2.py" "$INSTALL_DIR/quiz_factory.py"

# V3 stabilisée : toutes les corrections de production sont appliquées ici en un passage.
python3 - "$INSTALL_DIR/quiz_factory.py" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')

def replace_once(old, new, label):
    global text
    if old in text:
        text = text.replace(old, new, 1)
        return
    # local_finalize a été le point fragile des versions précédentes :
    # si le bloc exact diffère légèrement, on remplace proprement toute la fonction.
    if label == 'local_finalize V3':
        start = text.find('def local_finalize(')
        end = text.find('\ndef review_text(', start)
        if start >= 0 and end > start:
            text = text[:start] + new.rstrip() + '\n' + text[end + 1:]
            return
    raise SystemExit(f'Bloc introuvable: {label}')

# Réglages de base et compatibilité des catégories/types.
replace_once(
    "GROQ_RESEARCH_MODEL = os.getenv('GROQ_RESEARCH_MODEL', 'groq/compound')",
    "GROQ_RESEARCH_MODEL = os.getenv('GROQ_RESEARCH_MODEL', 'groq/compound-mini')",
    'modèle Groq'
)
replace_once(
    "BATCH_SIZE = max(2, min(8, int(os.getenv('BATCH_SIZE', '6'))))",
    "BATCH_SIZE = max(1, min(8, int(os.getenv('BATCH_SIZE', '1'))))",
    'batch size'
)
replace_once(
    "SLEEP_SECONDS = max(15, int(os.getenv('SLEEP_SECONDS', '45')))",
    "SLEEP_SECONDS = max(60, int(os.getenv('SLEEP_SECONDS', '360')))",
    'cadence daemon'
)
replace_once(
    "GROQ_COOLDOWN_SECONDS = max(60, int(os.getenv('GROQ_COOLDOWN_SECONDS', '900')))",
    "GROQ_COOLDOWN_SECONDS = max(60, int(os.getenv('GROQ_COOLDOWN_SECONDS', '60')))",
    'cooldown Groq'
)
replace_once(
    "NUMERIC_WEAK = {'Langue française','Littérature','Expressions françaises des régions','Anglais','Logique & devinettes'}",
    "NUMERIC_WEAK = {'Langue française','Littérature','Expressions françaises des régions','Anglais','Logique & devinettes','Arbre généalogique'}",
    'types incompatibles'
)

# Auteur local : sortie bornée, sans thinking, difficulté mieux explicitée.
replace_once(
    "        'stream': False,\n        'format': qwen_schema(),",
    "        'stream': False,\n        'think': False,\n        'format': qwen_schema(),",
    'think Qwen'
)
replace_once(
    "'options': {'temperature':0.62,'top_p':0.82,'num_ctx':4096},",
    "'options': {'temperature':0.45,'top_p':0.82,'num_ctx':4096,'num_predict':1200},",
    'options Qwen'
)
replace_once(
    "Catégorie exacte : {category}. Difficulté visée : {difficulty}. Type exact : {qtype}.",
    "Catégorie exacte : {category}. Difficulté OBLIGATOIRE : {difficulty}. Type exact : {qtype}.\nÉchelle visée : Facile=70-95% de réussite, Moyen=35-69%, Difficile=8-34%. La candidate doit réellement correspondre au niveau demandé.",
    'difficulté auteur'
)
replace_once(
    "'intruder': 'INTRUS : 4 éléments du même domaine ; trois partagent une propriété claire, un seul est l’intrus.',",
    "'intruder': 'INTRUS : 4 éléments comparables ; trois partagent une propriété exacte explicitée sans ambiguïté dans la question, un seul est l’intrus. Évite un intrus trivialement hors catégorie.',",
    'règle intrus'
)
replace_once(
    "        q['type'] = qtype\n        result.append(q)",
    "        q['type'] = qtype\n        q['_requested_difficulty'] = difficulty\n        result.append(q)",
    'difficulté candidate'
)
replace_once(
    "        'id': q.get('id',''), 'category': q.get('category',''), 'type': q.get('type',''),\n        'question': q.get('question',''), 'options': q.get('options') or [],",
    "        'id': q.get('id',''), 'category': q.get('category',''), 'type': q.get('type',''),\n        'difficulty_target': q.get('_requested_difficulty',''),\n        'question': q.get('question',''), 'options': q.get('options') or [],",
    'difficulty blind candidate'
)

# Diagnostics Qwen.
replace_once(
    """    r = session.post(f'{OLLAMA_URL}/api/chat', json=payload, timeout=600)\n    r.raise_for_status()\n    data = json.loads(r.json().get('message',{}).get('content',''))\n""",
    """    r = session.post(f'{OLLAMA_URL}/api/chat', json=payload, timeout=600)\n    r.raise_for_status()\n    ollama_reply = r.json()\n    content = ollama_reply.get('message',{}).get('content','')\n    try:\n        data = json.loads(content)\n    except json.JSONDecodeError as exc:\n        reason = ollama_reply.get('done_reason','inconnu')\n        raise RuntimeError(f'Qwen JSON incomplet/invalide (done_reason={reason}, chars={len(content)}): {exc}') from exc\n""",
    'parsing Qwen'
)

# Groq : Compound Mini, Basic Web Search, une seule recherche, diagnostics complets.
replace_once(
    "return {'Authorization': f'Bearer {GROQ_API_KEY}', 'Content-Type': 'application/json', 'Groq-Model-Version': 'latest'}",
    "return {'Authorization': f'Bearer {GROQ_API_KEY}', 'Content-Type': 'application/json', 'Groq-Model-Version': '2025-07-23'}",
    'version Groq'
)
replace_once(
    "'compound_custom': {'tools': {'enabled_tools': ['web_search','visit_website']}},",
    "'compound_custom': {'tools': {'enabled_tools': ['web_search']}},\n        'search_settings': {'country': 'france'},",
    'outils Groq'
)
replace_once(
    "Les réponses de l'auteur sont volontairement cachées. Recherche sur le Web pour résoudre chaque question indépendamment.",
    "Les réponses de l'auteur sont volontairement cachées. Tu DOIS effectuer une vraie recherche Web avec web_search avant de répondre. Résous chaque question indépendamment et signale aussi les imprécisions terminologiques à corriger.",
    'prompt recherche Groq'
)
replace_once(
    "'max_completion_tokens': 12000,",
    "'max_completion_tokens': 1500,",
    'budget Groq research'
)

old_cooldown = '''def mark_groq_cooldown(response=None):
    global groq_disabled_until
    wait = GROQ_COOLDOWN_SECONDS
    if response is not None:
        try:
            wait = max(wait, int(response.headers.get('retry-after','0') or 0))
        except Exception:
            pass
    groq_disabled_until = time.time() + wait
    print(f'  Groq indisponible/quota atteint → secours local pendant ~{wait//60} min', flush=True)
'''
new_cooldown = '''def mark_groq_cooldown(response=None):
    global groq_disabled_until
    wait = GROQ_COOLDOWN_SECONDS
    details = []
    if response is not None:
        try:
            retry = response.headers.get('retry-after','')
            if retry:
                wait = max(wait, int(float(retry)))
        except Exception:
            pass
        for key, label in [
            ('x-ratelimit-remaining-requests','req restantes'),
            ('x-ratelimit-remaining-tokens','tokens restants'),
            ('x-ratelimit-reset-requests','reset req'),
            ('x-ratelimit-reset-tokens','reset tokens'),
        ]:
            value = response.headers.get(key)
            if value:
                details.append(f'{label}={value}')
        try:
            body = response.json()
            message = str((body.get('error') or {}).get('message') or '')[:300]
            if message:
                details.append(f'message={message}')
        except Exception:
            pass
    groq_disabled_until = time.time() + wait
    suffix = (' · ' + ' · '.join(details)) if details else ''
    print(f'  Groq 429 → secours local ~{wait}s{suffix}', flush=True)
'''
replace_once(old_cooldown, new_cooldown, 'cooldown détaillé')

old_http = """    r = session.post('https://api.groq.com/openai/v1/chat/completions', headers=groq_headers(), json=payload, timeout=180)
    if r.status_code == 429:
        mark_groq_cooldown(r)
        raise RuntimeError('groq_quota')
    r.raise_for_status()
    data = r.json()
"""
new_http = """    payload_bytes = len(json.dumps(payload, ensure_ascii=False).encode('utf-8'))
    r = session.post('https://api.groq.com/openai/v1/chat/completions', headers=groq_headers(), json=payload, timeout=180)
    if r.status_code == 429:
        mark_groq_cooldown(r)
        raise RuntimeError('groq_quota')
    if r.status_code >= 400:
        try:
            detail = json.dumps(r.json(), ensure_ascii=False)[:1200]
        except Exception:
            detail = (r.text or '')[:1200]
        raise RuntimeError(f'Groq HTTP {r.status_code} (payload={payload_bytes} octets): {detail}')
    data = r.json()
"""
replace_once(old_http, new_http, 'HTTP Groq')

old_sources = '''    sources = []
    for tool in msg.get('executed_tools') or []:
        for sr in tool.get('search_results') or []:
            url = sr.get('url') or sr.get('link')
            if url and not any(x.get('url') == url for x in sources):
                sources.append({'source':'Groq web search','title':str(sr.get('title') or '')[:180], 'url':url})
    return {'text': content, 'sources': sources[:24], 'provider':'groq-compound'}
'''
new_sources = '''    sources = []
    def add_source(url, title=''):
        url = str(url or '').strip().rstrip('.,;:')
        if url.startswith(('http://','https://')) and not any(x.get('url') == url for x in sources):
            sources.append({'source':'Groq web search','title':str(title or '')[:180], 'url':url})

    for tool in msg.get('executed_tools') or []:
        if not isinstance(tool, dict):
            continue
        raw_results = tool.get('search_results')
        if isinstance(raw_results, dict):
            results = raw_results.get('results') or []
        elif isinstance(raw_results, list):
            results = raw_results
        else:
            results = []
        for sr in results:
            if isinstance(sr, dict):
                add_source(sr.get('url') or sr.get('link'), sr.get('title'))
        if not results:
            for url in re.findall(r'https?://[^\\s<>\\]\\[(){}"\\\\]+', str(tool.get('output') or '')):
                add_source(url)
    if not sources:
        for url in re.findall(r'https?://[^\\s<>\\]\\[(){}"\\\\]+', content):
            add_source(url)
    if not sources:
        raise RuntimeError('Groq web_search sans source exploitable')
    return {'text': content, 'sources': sources[:24], 'provider':'groq-compound-mini+gemma3'}
'''
replace_once(old_sources, new_sources, 'sources Groq')

# Schéma final : échelles explicites et types multimédia supportés.
replace_once(
    "'type':{'type':'string','enum':['mcq','truefalse','numeric','free','buzzer','intruder','estimation','progressive']},",
    "'type':{'type':'string','enum':['mcq','truefalse','numeric','free','buzzer','intruder','estimation','progressive','image_mystery','location']},",
    'types review schema'
)
replace_once(
    "'expected_success_pct':{'type':'number'}, 'quality_score':{'type':'integer'},",
    "'expected_success_pct':{'type':'number','minimum':0,'maximum':100}, 'quality_score':{'type':'integer','minimum':0,'maximum':100},",
    'échelles schema'
)
replace_once(
    "if qtype not in {'mcq','truefalse','numeric','free','buzzer','intruder','estimation','progressive'}:",
    "if qtype not in {'mcq','truefalse','numeric','free','buzzer','intruder','estimation','progressive','image_mystery','location'}:",
    'types normalizer'
)

old_scores = """    pct = max(1, min(99, float(raw.get('expected_success_pct') or 0)))
    quality = max(0, min(100, int(raw.get('quality_score') or 0)))
    if pct < 8 or quality < 76:
        return None
    difficulty = 'Facile' if pct >= 70 else 'Moyen' if pct >= 35 else 'Difficile'
"""
new_scores = """    try:
        pct = float(raw.get('expected_success_pct') or 0)
    except Exception:
        pct = 0
    if 0 < pct <= 1:
        pct *= 100
    pct = max(1, min(99, pct))
    try:
        quality_raw = float(raw.get('quality_score') or 0)
    except Exception:
        quality_raw = 0
    if 0 < quality_raw <= 1:
        quality_raw *= 100
    quality = max(0, min(100, int(round(quality_raw))))
    if pct < 8 or quality < 76:
        return None
    difficulty = 'Facile' if pct >= 70 else 'Moyen' if pct >= 35 else 'Difficile'
    requested = str(evidence.get('requested_difficulty') or '').strip()
    if requested and difficulty != requested:
        return None
"""
replace_once(old_scores, new_scores, 'normalisation scores/difficulté')

replace_once(
    "    if len(question) < 10 or not explanation or not topic_key:\n        return None",
    "    if len(question) < 10 or not explanation or not topic_key:\n        return None\n    if re.search(r'\\b(dossier factuel|documents? fournis?|sources? (?:confirment|indiquent)|recherche web)\\b', explanation, re.I):\n        return None",
    'explication joueur'
)

# Gemma devient rédacteur final : précision éditoriale + difficulté obligatoire + échelles 0-100.
old_local = '''def local_finalize(category, candidates, evidence):
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
        'keep_alive':0,
    }
    r = session.post(f'{OLLAMA_URL}/api/chat', json=payload, timeout=900)
    r.raise_for_status()
    parsed = json.loads(r.json().get('message',{}).get('content',''))
    return [q for q in (normalize_review(x, category, evidence) for x in parsed.get('reviews',[])) if q]
'''
new_local = '''def local_finalize(category, candidates, evidence):
    requested = candidates[0].get('_requested_difficulty','') if candidates else ''
    evidence = dict(evidence)
    evidence['requested_difficulty'] = requested
    ranges = {'Facile':(70,95), 'Moyen':(35,69), 'Difficile':(8,34)}
    lo, hi = ranges.get(requested, (8,95))
    prompt = f"""Tu es le RÉDACTEUR EN CHEF FINAL d'un quiz français pour adultes. Les réponses de l'auteur sont cachées.
Utilise UNIQUEMENT le dossier factuel fourni pour établir les faits et les réponses.

DIFFICULTÉ OBLIGATOIRE : {requested or 'non précisée'} ; expected_success_pct doit être compris entre {lo} et {hi}.
Si la candidate est hors niveau, tu peux reformuler la question ou améliorer les distracteurs en restant STRICTEMENT sur les faits démontrés. Si ce n'est pas possible sans inventer, approved=false.

RÈGLES ÉDITORIALES :
- Corrige toute imprécision terminologique, grammaire maladroite ou formulation ambiguë avant d'approuver.
- La question finale doit être naturelle à l'oral, précise et intéressante.
- L'explication est destinée AUX JOUEURS : explique directement le fait en 1 ou 2 phrases. Ne mentionne jamais dossier, document, source, recherche Web ni processus de vérification.
- Intrus : propriété commune exacte et explicite, quatre options comparables, intrus non trivial.
- QCM : exactement 4 options homogènes et une seule correcte.
- Vrai/faux : answer=true ou false.
- Numérique/estimation : valeur stable et unité si nécessaire.
- Libre/buzzer : réponse courte unique ; accepted_answers seulement variantes équivalentes.
- Progressive : exactement 4 ou 5 indices vrais, non redondants, du plus difficile au plus évident, sans contenir la réponse.
- image_mystery/location : conserve le type et une réponse courte unique.

ÉCHELLES OBLIGATOIRES 0-100 :
- expected_success_pct est un POURCENTAGE entre 0 et 100 ; jamais 0.95 pour 95%.
- 70-95=Facile ; 35-69=Moyen ; 8-34=Difficile ; <8=trop obscur.
- quality_score est une NOTE ENTIÈRE 0-100 : 90-100 excellent, 80-89 bon, 76-79 acceptable, <76 rejet.
- Ne mets jamais quality_score=0 seulement parce que la difficulté initiale était mauvaise : réécris si possible, sinon approved=false.

approved=true uniquement si la version finale est factuellement démontrée, univoque, bien formulée ET dans la difficulté demandée.
Retourne uniquement le JSON conforme au schéma.
DOSSIER FACTUEL :
""" + evidence['text'] + "\nCANDIDATE :\n" + json.dumps(blind_candidates(candidates), ensure_ascii=False)
    payload = {
        'model': LOCAL_REVIEW_MODEL,
        'messages':[{'role':'user','content':prompt}],
        'stream':False,
        'format':review_schema(),
        'options':{'temperature':0,'num_ctx':8192,'num_predict':1400},
        'keep_alive':0,
    }
    r = session.post(f'{OLLAMA_URL}/api/chat', json=payload, timeout=900)
    r.raise_for_status()
    reply = r.json()
    content = reply.get('message',{}).get('content','')
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        reason = reply.get('done_reason','inconnu')
        raise RuntimeError(f'Gemma JSON incomplet/invalide (done_reason={reason}, chars={len(content)}): {exc}') from exc
    return [q for q in (normalize_review(x, category, evidence) for x in parsed.get('reviews',[])) if q]
'''
replace_once(old_local, new_local, 'local_finalize V3')

# Le chemin texte utilise une seule requête cloud, puis Gemma local.
old_review = '''            evidence = groq_research(candidates)
            reviewed = groq_finalize(category, candidates, evidence)
            print(f'  Vérification Groq : {len(reviewed)}/{len(candidates)} retenues · {len(evidence["sources"])} sources', flush=True)
            return reviewed
'''
new_review = '''            evidence = groq_research(candidates)
            reviewed = local_finalize(category, candidates, evidence)
            print(f'  Vérification Groq Web + Gemma local : {len(reviewed)}/{len(candidates)} retenues · {len(evidence["sources"])} sources', flush=True)
            return reviewed
'''
replace_once(old_review, new_review, 'review_text V3')

# Média : vision et finalisation restent locales.
old_media = '''    if groq_available():
        try:
            reviewed = groq_finalize(candidate['category'], [candidate], evidence)
        except Exception:
            reviewed = []
    else:
        reviewed = local_finalize(candidate['category'], [candidate], evidence)
'''
replace_once(old_media, "    reviewed = local_finalize(candidate['category'], [candidate], evidence)\n", 'review_media local')
replace_once(
    "'stream':False,'format':schema,'options':{'temperature':0,'num_ctx':4096},'keep_alive':0",
    "'stream':False,'format':schema,'options':{'temperature':0,'num_ctx':4096,'num_predict':400},'keep_alive':0",
    'vision bornée'
)

path.write_text(text, encoding='utf-8')
PY

python3 -m py_compile "$INSTALL_DIR/quiz_factory.py"
cp "$SCRIPT_DIR/requirements.txt" "$INSTALL_DIR/requirements.txt"
python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install -r "$INSTALL_DIR/requirements.txt"

if [ ! -f "$ENV_FILE" ]; then
  cp "$SCRIPT_DIR/grand-quiz-factory.env.example" "$ENV_FILE"
else
  grep -q '^LOCAL_REVIEW_MODEL=' "$ENV_FILE" || echo 'LOCAL_REVIEW_MODEL=gemma3:4b' >> "$ENV_FILE"
  grep -q '^GROQ_API_KEY=' "$ENV_FILE" || echo 'GROQ_API_KEY=' >> "$ENV_FILE"
  grep -q '^GROQ_RESEARCH_MODEL=' "$ENV_FILE" || echo 'GROQ_RESEARCH_MODEL=groq/compound-mini' >> "$ENV_FILE"
fi

set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s#^${key}=.*#${key}=${value}#" "$ENV_FILE"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}
set_env BATCH_SIZE 1
set_env GROQ_RESEARCH_MODEL groq/compound-mini
set_env GROQ_COOLDOWN_SECONDS 60
set_env SLEEP_SECONDS 360
chmod 600 "$ENV_FILE"

cat > "$SERVICE_FILE" <<'EOF'
[Unit]
Description=Grand Quiz HDJ question factory v3
After=network-online.target ollama.service
Wants=network-online.target
Requires=ollama.service

[Service]
Type=simple
EnvironmentFile=/etc/grand-quiz-factory.env
ExecStart=/opt/grand-quiz-factory/venv/bin/python /opt/grand-quiz-factory/quiz_factory.py --daemon
Restart=on-failure
RestartSec=20
Nice=10
WorkingDirectory=/opt/grand-quiz-factory

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

echo
echo "Installation / mise à jour V3 qualité terminée."
echo "Auteur : Qwen3 4B local · think=false · num_predict=1200"
echo "Recherche : Groq Compound Mini 2025-07-23 · Basic Web Search · 1500 tokens max"
echo "Validation : Gemma 3 4B local · difficulté cible obligatoire · score 0-100 · num_predict=1400"
echo "Éditorial : reformulation précise, explication joueur, intrus non trivial"
echo "Types image_mystery/location acceptés par le schéma final"
echo "BATCH_SIZE=1 · SLEEP_SECONDS=360 · GROQ_COOLDOWN_SECONDS=60"
echo "Le service n'est pas activé automatiquement : on valide encore quelques questions avant daemon."
echo
