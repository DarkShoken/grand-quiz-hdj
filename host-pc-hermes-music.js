(() => {
  const SOURCE = 'https://pc-hermes.tail1da920.ts.net/Millionaire.mp3';
  const audio = new Audio(SOURCE);
  audio.loop = true;
  audio.preload = 'metadata';
  audio.volume = 0.22;

  let started = false;

  function setStatus(text, kind = '') {
    const node = document.getElementById('generationStatus');
    if (!node) return;
    node.dataset.musicStatus = text;
    if (kind === 'error') console.error(text);
  }

  function startMusic() {
    try { audio.currentTime = 0; } catch {}
    const promise = audio.play();
    if (promise && typeof promise.then === 'function') {
      promise.then(() => {
        started = true;
        setStatus('Musique de partie active.');
      }).catch((error) => {
        started = false;
        console.error('Impossible de lire la musique depuis PC-HERMES', error);
        const node = document.getElementById('generationStatus');
        if (node) node.textContent = '⚠️ Musique inaccessible depuis PC-HERMES — vérifie le Funnel.';
      });
    }
  }

  function stopMusic() {
    audio.pause();
    try { audio.currentTime = 0; } catch {}
    started = false;
  }

  // Les boutons de lancement sont créés dynamiquement dans la prévisualisation.
  // Le handler en capture appelle play() directement pendant le clic utilisateur,
  // ce qui évite le blocage d'autoplay de Chrome.
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('button');
    if (!button) return;

    if (button.id === 'launchGame' || button.id === 'launchGameBottom') {
      startMusic();
      return;
    }

    if (button.id === 'resetBtn' || button.id === 'resetInline') {
      stopMusic();
    }
  }, true);

  // Arrêt automatique quand l'écran de fin apparaît.
  const hostStage = document.getElementById('hostStage');
  if (hostStage) {
    const observer = new MutationObserver(() => {
      if (hostStage.querySelector('#resetInline') && started) stopMusic();
    });
    observer.observe(hostStage, { childList: true, subtree: true });
  }

  window.GrandQuizHostMusic = {
    source: SOURCE,
    start: startMusic,
    stop: stopMusic,
    audio,
  };
})();
