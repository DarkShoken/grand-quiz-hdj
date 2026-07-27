# Le Grand Quiz — HDJ Manosque

Jeu TV multijoueur léger pour l'Hôpital de Jour de Manosque.

- `index.html` : écran TV et lobby avec QR code
- `host.html` : console soignant
- `play.html` : interface joueur sur téléphone
- `shared.js` : synchronisation Supabase Realtime
- `questions.js` : banque locale de secours
- `api/generate-questions.js` : génération de nouvelles questions par IA

Le projet est indépendant du blind test et peut être déployé directement sur Vercel depuis la branche `main`.

## Activer la génération IA sur Vercel

Dans **Settings → Environment Variables** du projet Vercel, ajouter :

- `OPENAI_API_KEY` : clé secrète de l'API OpenAI
- `OPENAI_MODEL` : facultatif, valeur par défaut `gpt-5-mini`

Appliquer la variable aux environnements souhaités, puis redéployer le projet. La clé reste utilisée uniquement par la fonction serveur Vercel et n'est jamais envoyée aux téléphones des joueurs.
