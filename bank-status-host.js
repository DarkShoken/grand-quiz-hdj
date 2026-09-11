(() => {
  const TARGET_PER_CATEGORY = 50;
  const CATEGORY_COUNT = 39;
  const EXPECTED_TOTAL = TARGET_PER_CATEGORY * CATEGORY_COUNT;
  const CACHE_EPOCH_KEY = 'grand-quiz-bank-cache-epoch';
  const CACHE_EPOCH = 'gq26-1950-20260911-v1';
  const LEGACY_CACHE_KEY = 'grand-quiz-bank-cache-v2';
  let node = null;

  try {
    if (localStorage.getItem(CACHE_EPOCH_KEY) !== CACHE_EPOCH) {
      localStorage.removeItem(LEGACY_CACHE_KEY);
      localStorage.setItem(CACHE_EPOCH_KEY, CACHE_EPOCH);
    }
  } catch {}

  function ensure() {
    if (node || !document.getElementById('generationStatus')) return;
    node = document.createElement('div');
    node.id = 'verifiedBankStatus';
    node.className = 'muted small';
    node.style.marginTop = '7px';
    document.getElementById('generationStatus').after(node);
  }

  async function refresh() {
    ensure();
    if (!node || !window.GrandQuizVerifiedBank?.stats) return;
    try {
      const rows = await window.GrandQuizVerifiedBank.stats();
      const total = (rows || []).reduce((sum, row) => sum + (Number(row.question_count) || 0), 0);
      const categories = new Set((rows || []).filter((row) => Number(row.question_count) > 0).map((row) => row.category)).size;
      node.textContent = `🧠 Banque vérifiée : ${total.toLocaleString('fr-FR')} question${total > 1 ? 's' : ''} active${total > 1 ? 's' : ''} · ${categories}/${CATEGORY_COUNT} catégories · cible ${EXPECTED_TOTAL.toLocaleString('fr-FR')}`;
      node.style.color = total === EXPECTED_TOTAL && categories === CATEGORY_COUNT ? '#7bf8d3' : '#ffd166';
    } catch {
      node.textContent = '🧠 Banque vérifiée : état indisponible pour le moment.';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, { once: true });
  else refresh();
  setInterval(refresh, 60000);
})();
