(() => {
  let scheduledFrame = null;

  function fitGroup(group, itemSelector, minSize, maxSize) {
    const items = [...group.querySelectorAll(`:scope > ${itemSelector}`)]
      .filter((item) => item.clientWidth > 0 && item.clientHeight > 0);
    if (!items.length) return;

    items.forEach((item) => {
      item.style.fontSize = `${minSize}px`;
      item.style.lineHeight = '1.02';
    });

    const fits = (size) => {
      items.forEach((item) => { item.style.fontSize = `${size}px`; });
      return items.every((item) =>
        item.scrollHeight <= item.clientHeight + 1 &&
        item.scrollWidth <= item.clientWidth + 1
      );
    };

    let low = minSize;
    let high = maxSize;
    let best = minSize;

    while (high - low > 0.4) {
      const middle = (low + high) / 2;
      if (fits(middle)) {
        best = middle;
        low = middle;
      } else {
        high = middle;
      }
    }

    items.forEach((item) => {
      item.style.fontSize = `${Math.floor(best * 10) / 10}px`;
    });
  }

  function fitAllAnswers() {
    scheduledFrame = null;

    const viewportHeight = Math.max(480, window.innerHeight || 720);
    const viewportWidth = Math.max(320, window.innerWidth || 1280);
    const tvMax = Math.max(52, Math.min(82, viewportHeight * 0.078, viewportWidth * 0.055));
    const tvMin = Math.max(30, Math.min(40, viewportHeight * 0.038));
    const mobileMax = Math.max(34, Math.min(52, viewportWidth * 0.105));
    const mobileMin = Math.max(23, Math.min(30, viewportWidth * 0.065));

    document.querySelectorAll('.answer-grid').forEach((grid) => {
      fitGroup(grid, '.answer-tile', tvMin, tvMax);
    });

    document.querySelectorAll('.mobile-options').forEach((grid) => {
      fitGroup(grid, '.mobile-option', mobileMin, mobileMax);
    });
  }

  function scheduleFit() {
    if (scheduledFrame !== null) cancelAnimationFrame(scheduledFrame);
    scheduledFrame = requestAnimationFrame(() => {
      requestAnimationFrame(fitAllAnswers);
    });
  }

  const observer = new MutationObserver(scheduleFit);

  function start() {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    scheduleFit();
    document.fonts?.ready?.then(scheduleFit).catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.addEventListener('resize', scheduleFit);
  window.addEventListener('orientationchange', scheduleFit);
  window.GrandQuizAnswerFit = { fit: scheduleFit };
})();
