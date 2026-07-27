# Le Grand Quiz — HDJ Manosque

Jeu TV multijoueur léger pour l'Hôpital de Jour de Manosque.

- `index.html` : écran TV et lobby avec QR code
- `host.html` : console soignant
- `play.html` : interface joueur sur téléphone
- `shared.js` : synchronisation Supabase Realtime
- `questions.js` : banque locale de secours
- `api/generate-questions.js` : génération de nouvelles questions avec Gemini

Le projet est indépendant du blind test et peut être déployé directement sur Vercel depuis la branche `main`.

## Activer Gemini sur Vercel

Dans **Settings → Environment Variables** du projet Vercel, ajouter :

- `GEMINI_API_KEY` : clé secrète créée dans Google AI Studio
- `GEMINI_MODEL` : facultatif, valeur par défaut `gemini-2.5-flash`

Appliquer la variable aux environnements souhaités, puis redéployer le projet. La clé reste utilisée uniquement par la fonction serveur Vercel et n'est jamais envoyée aux téléphones des joueurs.

Si Gemini est indisponible ou si le quota gratuit est atteint, le quiz utilise automatiquement la banque locale de secours.