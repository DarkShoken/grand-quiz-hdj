(() => {
  const TARGET_PER_CATEGORY = 300;
  const CATEGORY_COUNT = 39;
  let node = null;

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
      node.textContent = `🧠 Banque PC-HERMES : ${total.toLocaleString('fr-FR')} question${total > 1 ? 's' : ''} validée${total > 1 ? 's' : ''} · ${categories}/${CATEGORY_COUNT} catégories alimentées · cible ${CATEGORY_COUNT * TARGET_PER_CATEGORY}`;
      node.style.color = total >= 500 ? '#7bf8d3' : '#ffd166';
    } catch {
      node.textContent = '🧠 Banque PC-HERMES : état indisponible pour le moment.';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, { once: true });
  else refresh();
  setInterval(refresh, 60000);
})();
