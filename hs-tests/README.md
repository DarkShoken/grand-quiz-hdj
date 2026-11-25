# hs-tests — maquette locale pour l'atelier « Habiletés sociales »

Fichiers 100 % locaux : aucun serveur, aucune connexion Internet, aucune donnée envoyée
(tout reste dans le localStorage du navigateur du PC portable). Pensé pour un écran
partagé par l'animateur et les 5 patients : les votes se font à voix haute / mains levées,
l'animateur compte les « +1 » à l'écran.

## Utilisation
1. Récupérer ce dossier (branche `vibe/hs-formats-locaux-8583c3`) : ZIP de la branche, ou `git clone --branch vibe/hs-formats-locaux-8583c3 --depth 1 https://github.com/DarkShoken/grand-quiz-hdj.git`
2. Ouvrir `hs-tests/atelier-habiletes-sociales.html` en double-cliquant : fonctionne hors ligne.
3. Onglet « Accueil » : coller vos questions (une par ligne, format `thème | question | relance`) puis « Charger mes questions ».

## Formats à tester
QCM ensemble (A/B/C en grand, tout le monde répond en même temps, +1 par voix, révélation du choix du groupe) ·
Conseil à un ami · Script à compléter (retenu au bilan) · Émotions (visages SVG, score du groupe) ·
Détective social (indices pour/contre, interprétations votées) · Échelle 1-5 (histogramme du groupe) ·
Bilan de séance copiable.

Barre du haut : thème (pastille de couleur), pioche sans répétition avec barre de progression, n° de séance,
minuteur, jeton de parole (P1..Pn), nombre de patients.
