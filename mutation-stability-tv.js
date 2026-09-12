(() => {
  const NativeMutationObserver = window.MutationObserver;
  if (!NativeMutationObserver || window.__grandQuizStableMutationObserver) return;
  window.__grandQuizStableMutationObserver = true;

  const TIMER_SELECTOR = [
    '#timerValue',
    '#tvRevealTimer',
    '#hostRevealTimer',
    '#hostRevealTimerStable',
    '#gameCountdownValue',
    '#gameCountdownOverlay',
    '#timerBar',
    '.progress',
    '.timer-wrap',
    '.reveal-auto-countdown',
    '.host-auto-next',
  ].join(',');

  function elementFromTarget(target) {
    if (!target) return null;
    if (target.nodeType === Node.ELEMENT_NODE) return target;
    return target.parentElement || null;
  }

  function isTimerMutation(mutation) {
    const element = elementFromTarget(mutation.target);
    return Boolean(element?.closest?.(TIMER_SELECTOR));
  }

  class StableMutationObserver extends NativeMutationObserver {
    constructor(callback) {
      super((mutations, observer) => {
        const filtered = mutations.filter((mutation) => !isTimerMutation(mutation));
        if (filtered.length) callback(filtered, observer);
      });
    }
  }

  window.MutationObserver = StableMutationObserver;
})();
