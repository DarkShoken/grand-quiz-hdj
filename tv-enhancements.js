(() => {
  const AUTO_NEXT_MS = 10000;
  const stage = document.getElementById('stage');
  let countdownTimer = null;
  let activeCard = null;

  function clearCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    activeCard = null;
  }

  function isRevealCard(card) {
    return Boolean(card && [...card.querySelectorAll('.badge')].some((badge) => badge.textContent.trim() === 'Réponse'));
  }

  function installCountdown() {
    const card = stage?.querySelector('.question-card');
    if (!isRevealCard(card)) {
      clearCountdown();
      return;
    }
    if (card === activeCard || card.querySelector('[data-reveal-countdown]')) return;

    clearCountdown();
    activeCard = card;
    const block = document.createElement('div');
    block.className = 'reveal-auto-countdown';
    block.dataset.revealCountdown = 'true';
    block.innerHTML = '<div id="tvRevealTimer" class="timer reveal-timer">10</div><div class="reveal-auto-label">Prochaine question</div>';
    card.appendChild(block);

    const deadline = Date.now() + AUTO_NEXT_MS;
    const update = () => {
      const seconds = Math.ceil(Math.max(0, deadline - Date.now()) / 1000);
      const timer = document.getElementById('tvRevealTimer');
      if (timer) timer.textContent = String(seconds);
      if (seconds <= 0 && countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
    };

    update();
    countdownTimer = window.setInterval(update, 100);
  }

  const observer = new MutationObserver(() => window.requestAnimationFrame(installCountdown));
  if (stage) observer.observe(stage, { childList: true, subtree: true });
})();
