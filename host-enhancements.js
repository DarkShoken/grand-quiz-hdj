(() => {
  const AUTO_NEXT_MS = 10000;
  const categoriesBox = document.getElementById('categories');
  const hostStage = document.getElementById('hostStage');
  let countdownTimer = null;
  let autoClickTimer = null;
  let activeReveal = null;

  function clearAutoAdvance() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (autoClickTimer) {
      clearTimeout(autoClickTimer);
      autoClickTimer = null;
    }
    activeReveal = null;
  }

  function uncheckDefaultCategories() {
    categoriesBox?.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = false;
    });
  }

  function installCategoryActions() {
    if (!categoriesBox || document.getElementById('categoryQuickActions')) return;
    const actions = document.createElement('div');
    actions.id = 'categoryQuickActions';
    actions.className = 'category-quick-actions';
    actions.innerHTML = '<button id="checkAllCategories" class="btn" type="button">Tout cocher</button><button id="uncheckAllCategories" class="btn" type="button">Tout décocher</button>';
    categoriesBox.before(actions);
    document.getElementById('checkAllCategories')?.addEventListener('click', () => {
      categoriesBox.querySelectorAll('input[type="checkbox"]').forEach((input) => { input.checked = true; });
    });
    document.getElementById('uncheckAllCategories')?.addEventListener('click', () => {
      categoriesBox.querySelectorAll('input[type="checkbox"]').forEach((input) => { input.checked = false; });
    });
  }

  function isRevealScreen() {
    if (!hostStage) return false;
    return [...hostStage.querySelectorAll('.badge')].some((badge) => badge.textContent.trim() === 'Réponse');
  }

  function startRevealCountdown() {
    if (!hostStage || !isRevealScreen()) {
      clearAutoAdvance();
      return;
    }

    const nextButton = document.getElementById('nextBtn');
    const rankButton = document.getElementById('rankBtn');
    if (!nextButton) return;

    const revealKey = hostStage.querySelector('.host-question')?.textContent || 'reveal';
    if (activeReveal === revealKey && document.getElementById('hostAutoNextTimer')) return;
    clearAutoAdvance();
    activeReveal = revealKey;

    const block = document.createElement('div');
    block.className = 'host-auto-next';
    block.innerHTML = '<div id="hostAutoNextTimer" class="host-auto-next-circle">10</div><div><strong>Question suivante automatique</strong><span>Tu peux avancer immédiatement ou afficher le classement.</span></div>';
    const actions = nextButton.closest('.actions');
    actions?.before(block);

    const deadline = Date.now() + AUTO_NEXT_MS;
    const update = () => {
      const left = Math.max(0, deadline - Date.now());
      const seconds = Math.ceil(left / 1000);
      const circle = document.getElementById('hostAutoNextTimer');
      if (circle) circle.textContent = String(seconds);
    };

    update();
    countdownTimer = window.setInterval(update, 100);
    autoClickTimer = window.setTimeout(() => {
      clearAutoAdvance();
      if (document.body.contains(nextButton)) nextButton.click();
    }, AUTO_NEXT_MS + 80);

    nextButton.addEventListener('click', clearAutoAdvance, { once: true });
    rankButton?.addEventListener('click', clearAutoAdvance, { once: true });
  }

  uncheckDefaultCategories();
  installCategoryActions();

  const observer = new MutationObserver(() => {
    window.requestAnimationFrame(startRevealCountdown);
  });
  if (hostStage) observer.observe(hostStage, { childList: true, subtree: true });
})();
