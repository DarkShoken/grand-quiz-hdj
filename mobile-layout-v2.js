(() => {
  let scheduled = null;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function updateVisibleViewport() {
    const height = Math.max(320, Math.floor(window.visualViewport?.height || window.innerHeight || 640));
    document.documentElement.style.setProperty('--quiz-visible-height', `${height}px`);
  }

  function prepare(items) {
    items.forEach((item) => {
      const text = String(item.textContent || '').replace(/\s+/g, ' ').trim();
      const singleWord = Boolean(text && !text.includes(' '));
      item.style.wordBreak = 'normal';
      item.style.overflowWrap = 'normal';
      item.style.hyphens = 'none';
      item.style.whiteSpace = singleWord ? 'nowrap' : 'normal';
      item.style.setProperty('text-wrap', singleWord ? 'nowrap' : 'balance');
    });
  }

  function setFont(items, size, lineHeight) {
    items.forEach((item) => {
      item.style.fontSize = `${size}px`;
      item.style.lineHeight = String(lineHeight);
    });
  }

  function fits(items) {
    return items.every((item) =>
      item.scrollWidth <= item.clientWidth + 1 &&
      item.scrollHeight <= item.clientHeight + 1
    );
  }

  function largestFont(items, minSize, maxSize, lineHeight) {
    if (!items.length) return minSize;
    let low = minSize;
    let high = Math.max(minSize, maxSize);
    let best = minSize;
    setFont(items, minSize, lineHeight);

    while (high - low > 0.35) {
      const middle = (low + high) / 2;
      setFont(items, middle, lineHeight);
      if (fits(items)) {
        best = middle;
        low = middle;
      } else {
        high = middle;
      }
    }

    best = Math.floor(best * 10) / 10;
    setFont(items, best, lineHeight);
    return best;
  }

  function fitMobile() {
    updateVisibleViewport();

    document.querySelectorAll('.mobile-options').forEach((grid) => {
      const card = grid.closest('.player-card');
      const question = card?.querySelector('.mobile-question');
      const answers = [...grid.querySelectorAll(':scope > .mobile-option')]
        .filter((item) => item.clientWidth > 0 && item.clientHeight > 0);
      if (!card || !question || !answers.length) return;

      prepare(answers);
      question.style.whiteSpace = 'normal';
      question.style.wordBreak = 'normal';
      question.style.overflowWrap = 'normal';
      question.style.hyphens = 'none';
      question.style.setProperty('text-wrap', 'balance');

      const viewportWidth = Math.max(320, window.visualViewport?.width || window.innerWidth || 390);
      const viewportHeight = Math.max(420, window.visualViewport?.height || window.innerHeight || 700);

      const questionMin = clamp(viewportWidth * 0.055, 20, 27);
      const questionMax = clamp(Math.min(viewportWidth * 0.125, viewportHeight * 0.064), 34, 54);
      let questionSize = largestFont([question], questionMin, questionMax, 1.04);

      const answerMin = clamp(viewportWidth * 0.052, 18, 25);
      const answerMax = clamp(Math.min(viewportWidth * 0.145, viewportHeight * 0.07), 32, 58);
      let answerSize = largestFont(answers, answerMin, answerMax, 1.02);

      const answerCeiling = questionSize * 1.18;
      if (answerSize > answerCeiling) {
        answerSize = answerCeiling;
        setFont(answers, answerSize, 1.02);
      }

      let attempts = 0;
      while ((card.scrollHeight > card.clientHeight + 1 || question.scrollHeight > question.clientHeight + 1 || !fits(answers)) && attempts < 30) {
        questionSize = Math.max(18, questionSize * 0.965);
        answerSize = Math.max(17, answerSize * 0.965);
        setFont([question], questionSize, 1.04);
        setFont(answers, answerSize, 1.02);
        attempts += 1;
      }
    });
  }

  function schedule() {
    if (scheduled !== null) cancelAnimationFrame(scheduled);
    scheduled = requestAnimationFrame(() => {
      scheduled = requestAnimationFrame(() => {
        scheduled = null;
        fitMobile();
      });
    });
  }

  const observer = new MutationObserver(schedule);

  function start() {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    schedule();
    document.fonts?.ready?.then(schedule).catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
})();
