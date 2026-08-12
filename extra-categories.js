(() => {
  const categories = window.GRAND_QUIZ_CATEGORIES;
  const bank = window.GRAND_QUIZ_QUESTIONS;
  if (!Array.isArray(categories)) return;

  const canonicalInventions = 'Inventions & découvertes';
  const additions = [
    'Records du monde',
    'Arbres',
    'Plantes',
    'Fruits',
    'Astronomie',
    canonicalInventions,
    'Arbre généalogique',
    'Anglais',
    'Automobile',
    'Agriculture',
    'Expressions françaises des régions',
  ];

  const cleaned = categories
    .map((category) => category === 'Inventions' ? canonicalInventions : category)
    .filter(Boolean);
  categories.splice(0, categories.length, ...new Set(cleaned));

  const existing = new Set(categories);
  for (const category of additions) {
    if (!existing.has(category)) {
      categories.push(category);
      existing.add(category);
    }
  }

  if (Array.isArray(bank)) {
    for (const question of bank) {
      if (question?.category === 'Inventions') question.category = canonicalInventions;
    }
  }
})();
