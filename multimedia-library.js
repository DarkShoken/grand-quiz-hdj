(() => {
  function svgData(svg) {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg.replace(/\n\s*/g, ' ').trim())}`;
  }

  const japanFlag = svgData(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600">
      <rect width="900" height="600" fill="#fff"/>
      <circle cx="450" cy="300" r="180" fill="#bc002d"/>
    </svg>`);

  const swissFlag = svgData(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
      <rect width="600" height="600" fill="#d52b1e"/>
      <rect x="250" y="120" width="100" height="360" fill="#fff"/>
      <rect x="120" y="250" width="360" height="100" fill="#fff"/>
    </svg>`);

  const saturn = svgData(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600">
      <rect width="900" height="600" rx="40" fill="#070817"/>
      <circle cx="450" cy="300" r="128" fill="#d9bc78"/>
      <ellipse cx="450" cy="300" rx="310" ry="92" fill="none" stroke="#ebd7a2" stroke-width="34" transform="rotate(-12 450 300)"/>
      <ellipse cx="450" cy="300" rx="250" ry="67" fill="none" stroke="#a58a55" stroke-width="12" transform="rotate(-12 450 300)"/>
      <path d="M334 247 Q450 220 566 247" stroke="#b89a5e" stroke-width="12" fill="none"/>
      <path d="M329 324 Q450 350 571 324" stroke="#c9aa69" stroke-width="10" fill="none"/>
    </svg>`);

  const dna = svgData(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600">
      <rect width="900" height="600" rx="40" fill="#0d1029"/>
      <path d="M250 80 C650 160 250 440 650 520" fill="none" stroke="#7dd3fc" stroke-width="24"/>
      <path d="M650 80 C250 160 650 440 250 520" fill="none" stroke="#c084fc" stroke-width="24"/>
      <g stroke="#f8fafc" stroke-width="12">
        <line x1="326" y1="123" x2="574" y2="123"/>
        <line x1="378" y1="190" x2="522" y2="190"/>
        <line x1="409" y1="260" x2="491" y2="260"/>
        <line x1="409" y1="340" x2="491" y2="340"/>
        <line x1="378" y1="410" x2="522" y2="410"/>
        <line x1="326" y1="477" x2="574" y2="477"/>
      </g>
    </svg>`);

  window.GRAND_QUIZ_MEDIA_LIBRARY = [
    {
      id: 'media-audio-beethoven5', category: 'Musique', difficulty: 'Facile', type: 'mcq', format: 'audio',
      question: 'Quel compositeur est associé au célèbre motif que vous allez entendre ?',
      options: ['Ludwig van Beethoven', 'Wolfgang A. Mozart', 'Antonio Vivaldi', 'Johann S. Bach'], answer: 0,
      explanation: 'Le motif court-court-court-long ouvre la Symphonie n° 5 de Beethoven.',
      media: { kind: 'synth', synth: 'beethoven5', label: 'Motif musical', duration: 5 },
    },
    {
      id: 'media-audio-frere-jacques', category: 'Musique', difficulty: 'Facile', type: 'mcq', format: 'audio',
      question: 'Quelle comptine traditionnelle reconnaissez-vous dans cet extrait ?',
      options: ['Frère Jacques', 'Au clair de la lune', 'À la claire fontaine', 'Sur le pont d’Avignon'], answer: 0,
      explanation: 'La mélodie jouée est celle de « Frère Jacques », comptine traditionnelle.',
      media: { kind: 'synth', synth: 'frere-jacques', label: 'Blind test', duration: 7 },
    },
    {
      id: 'media-audio-au-clair', category: 'Musique', difficulty: 'Facile', type: 'mcq', format: 'audio',
      question: 'Quel air traditionnel français est joué dans cet extrait ?',
      options: ['Au clair de la lune', 'Frère Jacques', 'Il était un petit navire', 'Meunier tu dors'], answer: 0,
      explanation: 'Il s’agit de la mélodie traditionnelle « Au clair de la lune ».',
      media: { kind: 'synth', synth: 'au-clair-de-la-lune', label: 'Blind test', duration: 7 },
    },
    {
      id: 'media-audio-morse-sos', category: 'Culture générale', difficulty: 'Moyen', type: 'mcq', format: 'audio',
      question: 'Quel signal international est représenté par cette séquence en code Morse ?',
      options: ['SOS', 'OK', 'STOP', 'GO'], answer: 0,
      explanation: 'Trois points, trois traits, trois points correspondent au signal SOS en code Morse.',
      media: { kind: 'synth', synth: 'morse-sos', label: 'Code Morse', duration: 5 },
    },
    {
      id: 'media-image-japon', category: 'Monde & cultures', difficulty: 'Facile', type: 'mcq', format: 'image',
      question: 'À quel pays appartient ce drapeau ?',
      options: ['Japon', 'Bangladesh', 'Indonésie', 'Singapour'], answer: 0,
      explanation: 'Le drapeau japonais représente un disque rouge sur fond blanc.',
      media: { kind: 'image', src: japanFlag, label: 'Image mystère', reveal: 'blur' },
    },
    {
      id: 'media-image-suisse', category: 'Géographie', difficulty: 'Facile', type: 'mcq', format: 'image',
      question: 'À quel pays appartient ce drapeau carré ?',
      options: ['Suisse', 'Danemark', 'Autriche', 'Géorgie'], answer: 0,
      explanation: 'Le drapeau suisse est rouge avec une croix blanche et possède une forme carrée.',
      media: { kind: 'image', src: swissFlag, label: 'Image mystère', reveal: 'blur' },
    },
    {
      id: 'media-image-saturne', category: 'Astronomie', difficulty: 'Facile', type: 'mcq', format: 'image',
      question: 'Quelle planète est représentée par cette illustration ?',
      options: ['Saturne', 'Jupiter', 'Uranus', 'Neptune'], answer: 0,
      explanation: 'Saturne est particulièrement reconnaissable à son vaste système d’anneaux.',
      media: { kind: 'image', src: saturn, label: 'Image mystère', reveal: 'blur' },
    },
    {
      id: 'media-image-adn', category: 'Sciences', difficulty: 'Facile', type: 'mcq', format: 'image',
      question: 'Quelle molécule est symbolisée par cette double hélice ?',
      options: ['ADN', 'Insuline', 'Hémoglobine', 'Cholestérol'], answer: 0,
      explanation: 'La double hélice est la représentation classique de la structure de l’ADN.',
      media: { kind: 'image', src: dna, label: 'Image mystère', reveal: 'blur' },
    },
    {
      id: 'media-clues-eiffel', category: 'France', difficulty: 'Facile', type: 'buzzer', format: 'clues',
      question: 'Qui trouvera le lieu mystère avec le moins d’indices ?', answerText: 'La tour Eiffel',
      explanation: 'La tour Eiffel, construite pour l’Exposition universelle de 1889, domine le Champ-de-Mars à Paris.',
      clues: ['Je suis à Paris.', 'J’ai été construite à la fin du XIXe siècle.', 'Mon nom vient d’un ingénieur français.', 'Je mesure plus de 300 mètres de haut.'],
    },
    {
      id: 'media-clues-saturne', category: 'Astronomie', difficulty: 'Facile', type: 'buzzer', format: 'clues',
      question: 'Quelle planète se cache derrière ces indices ?', answerText: 'Saturne',
      explanation: 'Saturne est une géante gazeuse, sixième planète du Système solaire, célèbre pour ses anneaux.',
      clues: ['Je suis une planète géante.', 'Je suis la sixième planète à partir du Soleil.', 'Je possède de nombreuses lunes.', 'Mes anneaux sont particulièrement spectaculaires.'],
    },
    {
      id: 'media-clues-curie', category: 'Sciences', difficulty: 'Moyen', type: 'buzzer', format: 'clues',
      question: 'Quelle scientifique se cache derrière ces indices ?', answerText: 'Marie Curie',
      explanation: 'Marie Curie a reçu deux prix Nobel, en physique puis en chimie.',
      clues: ['Je suis née à Varsovie en 1867.', 'J’ai travaillé sur la radioactivité.', 'J’ai reçu deux prix Nobel dans deux disciplines scientifiques.', 'Mon prénom est Marie.'],
    },
    {
      id: 'media-clues-marseille', category: 'France', difficulty: 'Moyen', type: 'buzzer', format: 'clues',
      question: 'Quelle ville française se cache derrière ces indices ?', answerText: 'Marseille',
      explanation: 'Marseille, fondée par des Grecs de Phocée vers 600 av. J.-C., est une grande ville portuaire méditerranéenne.',
      clues: ['Je suis située au bord de la Méditerranée.', 'Mon club de football joue au Stade Vélodrome.', 'Mon Vieux-Port est l’un de mes lieux emblématiques.', 'Je suis la préfecture des Bouches-du-Rhône.'],
    },
    {
      id: 'media-clues-pomme', category: 'Fruits', difficulty: 'Facile', type: 'buzzer', format: 'clues',
      question: 'Quel fruit se cache derrière ces indices ?', answerText: 'La pomme',
      explanation: 'La pomme est le fruit du pommier et existe dans de très nombreuses variétés.',
      clues: ['Je pousse sur un arbre.', 'Je peux être verte, jaune ou rouge.', 'On me transforme souvent en compote.', 'Je suis le fruit du pommier.'],
    },
    {
      id: 'media-clues-anglais', category: 'Anglais', difficulty: 'Facile', type: 'buzzer', format: 'clues',
      question: 'Quel mot anglais se cache derrière ces indices ?', answerText: 'Apple',
      explanation: '« Apple » signifie « pomme » en anglais.',
      clues: ['Je suis un nom commun anglais.', 'Je désigne un fruit.', 'Je commence par la lettre A.', 'En français, je signifie « pomme ».'],
    },
    {
      id: 'media-clues-tracteur', category: 'Agriculture', difficulty: 'Facile', type: 'buzzer', format: 'clues',
      question: 'Quel engin agricole se cache derrière ces indices ?', answerText: 'Le tracteur',
      explanation: 'Le tracteur fournit la puissance nécessaire pour tirer ou entraîner de nombreux outils agricoles.',
      clues: ['Je suis un véhicule.', 'Je travaille surtout dans les champs.', 'Je peux tracter une charrue ou une remorque.', 'Mes grandes roues arrière sont très reconnaissables.'],
    },
  ];
})();
