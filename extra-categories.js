(() => {
  const categories = window.GRAND_QUIZ_CATEGORIES;
  if (!Array.isArray(categories)) return;

  const additions = [
    'Records du monde',
    'Arbres',
    'Plantes',
    'Fruits',
    'Astronomie',
    'Inventions',
    'Arbre généalogique',
    'Anglais',
    'Automobile',
    'Agriculture',
  ];

  const existing = new Set(categories);
  for (const category of additions) {
    if (!existing.has(category)) {
      categories.push(category);
      existing.add(category);
    }
  }
})();
