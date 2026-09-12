(() => {
  const DESIGN_WIDTH = 1600;
  const DESIGN_HEIGHT = 900;
  const gameView = document.getElementById('gameView');
  if (!gameView) return;

  let frame = 0;

  function fit() {
    frame = 0;
    const vv = window.visualViewport;
    const width = Math.max(1, vv?.width || window.innerWidth || DESIGN_WIDTH);
    const height = Math.max(1, vv?.height || window.innerHeight || DESIGN_HEIGHT);
    const scale = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);

    gameView.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }

  function scheduleFit() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fit);
  }

  scheduleFit();
  window.addEventListener('resize', scheduleFit, { passive: true });
  window.addEventListener('orientationchange', scheduleFit, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleFit, { passive: true });
})();
