#!/usr/bin/env python3

CATEGORY_PROFILES = {
    "Animaux": "Privilégier animaux connus, habitat, alimentation, comportements et caractéristiques visibles. Éviter taxonomie, noms latins, familles scientifiques et anatomie spécialisée.",
    "Dessins animés": "Privilégier personnages, séries, studios et univers très connus en France. Éviter numéros d'épisodes, dates de diffusion précises, doubleurs obscurs et détails de production.",
    "Années 80, 90 & 2000": "Privilégier musique, cinéma, télévision, objets, jeux et phénomènes populaires largement connus. Éviter classements hebdomadaires, dates au jour près et anecdotes de niche.",
    "Inventions & découvertes": "Privilégier inventions majeures, inventeurs célèbres, usages et découvertes scolaires. Éviter numéros de brevet, variantes techniques et querelles de priorité.",
    "Records du monde": "Privilégier records emblématiques et faciles à contextualiser. Éviter micro-records, catégories Guinness de niche et valeurs mouvantes sans date explicite.",
    "Littérature": "Privilégier auteurs, œuvres, personnages et genres connus. Éviter détails éditoriaux, chapitres précis, personnages secondaires et bibliographie obscure.",
    "Architecture": "Privilégier monuments célèbres, villes, pays, styles et architectes connus. Éviter jargon structurel, détails de chantier et dimensions exactes non emblématiques.",
    "Sciences": "Privilégier phénomènes du quotidien, notions scolaires et grandes découvertes. Éviter nomenclature spécialisée, formules avancées et taxonomie scientifique.",
    "Logique & devinettes": "Proposer un raisonnement court, unique et vérifiable. Éviter pièges de formulation, connaissances externes cachées et ambiguïtés.",
    "Histoire": "Privilégier grands événements, personnages et repères chronologiques connus. Éviter dates secondaires au jour près, titulatures obscures et micro-événements.",
    "Célébrités": "Uniquement carrière, œuvres et faits publics stables. Éviter vie privée, rumeurs, fortune, couples et actualité mouvante.",
    "Corps humain": "Privilégier organes, fonctions et notions de santé générale très connues. Éviter anatomie de spécialiste, valeurs biologiques précises et terminologie médicale rare.",
    "Plantes": "Privilégier plantes courantes, usages connus, apparence et milieu. Éviter espèces botaniques de niche, taxonomie et noms latins.",
    "Arbres": "Privilégier arbres connus, fruits, feuilles, usages et milieux. Éviter classification botanique et détails dendrologiques spécialisés.",
    "Fruits": "Privilégier origine générale, goût, aspect, usage culinaire et culture courante. Éviter cultivars rares et classification botanique.",
    "Cuisine": "Privilégier plats connus, ingrédients usuels, techniques de base et spécialités célèbres. Éviter vocabulaire professionnel, procédés industriels et spécialités hyper-locales.",
    "Géographie": "Privilégier pays, capitales, grandes villes, reliefs et monuments connus. Éviter subdivisions administratives rares et micro-toponymes.",
    "Monde & cultures": "Privilégier traditions, langues, monuments et repères culturels largement documentés. Éviter pratiques très locales ou controversées.",
    "France": "Privilégier régions, villes, monuments, institutions et repères culturels connus. Éviter détails administratifs spécialisés.",
    "Numérique": "Privilégier usages courants, notions simples et histoire stable de l'informatique. Éviter versions logicielles, parts de marché et détails de protocoles.",
    "Automobile": "Privilégier marques, modèles emblématiques, principes de conduite et histoire générale. Éviter références moteur, finitions rares et chiffres techniques pointus.",
    "BTP & travaux": "Privilégier outils, matériaux, métiers et principes courants. Éviter normes, références réglementaires et calculs de spécialiste.",
    "Agriculture": "Privilégier cultures, animaux d'élevage, matériels courants et saisons. Éviter réglementation, chimie agricole et agronomie spécialisée.",
    "Jeux olympiques": "Privilégier sports, symboles, villes hôtes et champions très connus. Préciser l'édition pour les faits susceptibles de changer.",
    "Astronomie": "Privilégier planètes, Soleil, Lune, étoiles et missions célèbres. Éviter catalogues, magnitudes et paramètres orbitaux précis.",
    "Mythologie": "Privilégier dieux, héros, créatures et récits majeurs. Éviter variantes régionales rares et généalogies secondaires.",
    "Arts & peinture": "Privilégier artistes, œuvres, mouvements et musées célèbres. Éviter détails de provenance ou technique trop spécialisés.",
    "Cinéma & TV": "Privilégier films, séries, acteurs, personnages et réalisateurs connus. Éviter numéros d'épisodes, box-office très précis et détails de production.",
    "Musique": "Privilégier artistes, chansons, groupes, instruments et genres connus. Éviter classements, dates de sortie au jour près et crédits secondaires.",
    "Sport": "Privilégier règles de base, équipes, compétitions et champions connus. Éviter statistiques secondaires et records mouvants sans date.",
    "Jeux vidéo": "Privilégier franchises, personnages, consoles et studios connus. Éviter versions, patchs, speedruns et détails compétitifs de niche.",
    "Anglais": "Privilégier vocabulaire et expressions usuelles. Éviter idiomes rares, faux-amis discutables et nuances de registre avancées.",
    "Langue française": "Privilégier orthographe, vocabulaire et expressions courantes. Éviter terminologie grammaticale universitaire et exceptions rarissimes.",
    "Expressions françaises des régions": "Utiliser uniquement des expressions attestées et suffisamment connues. Éviter attributions régionales discutables ou hyper-locales.",
    "Arbre généalogique": "Privilégier relations familiales simples et déductibles. Éviter formulations complexes avec trop de générations.",
    "Nature & environnement": "Privilégier phénomènes naturels, écologie de base et gestes courants. Éviter indicateurs techniques et réglementation détaillée.",
    "Insolite": "Rester surprenant mais vérifiable et accessible. Éviter anecdotes invérifiables ou faits tellement rares qu'ils deviennent impossibles à deviner.",
    "Provence": "Privilégier villes, paysages, gastronomie, traditions et personnalités connues. Éviter micro-toponymes et détails historiques très locaux.",
}

DEFAULT_PROFILE = "Rester sur de la culture générale accessible à des adultes en HDJ. Éviter connaissances de spécialiste, jargon, précision inutile et anecdotes de niche."

def guidance(category: str) -> str:
    return CATEGORY_PROFILES.get(str(category or ""), DEFAULT_PROFILE)
