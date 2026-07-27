(() => {
  const stage = document.getElementById('hostStage');
  const startButton = document.getElementById('startBtn');
  const status = document.getElementById('generationStatus');
  const sourceSelect = document.getElementById('questionSourceSelect');
  if (!stage || !startButton || !status) return;

  const style = document.createElement('style');
  style.textContent = `
    body.quiz-auto-launching .preview-head,
    body.quiz-auto-launching .preview-list,
    body.quiz-auto-launching .preview-bottom { visibility:hidden!important; }
    .generation-error-card{padding:18px;border-radius:18px;background:rgba(239,71,111,.1);border:1px solid rgba(239,71,111,.28)}
    .generation-error-card strong{display:block;font-size:1.2rem;margin-bottom:7px;color:#ffb3c2}
  `;
  document.head.appendChild(style);

  let launching = false;

  function normalizeButtonText() {
    if (!startButton.disabled && startButton.textContent !== '✨ Générer et lancer') {
      startButton.textContent = '✨ Générer et lancer';
    }
  }

  function handlePreview() {
    const launchButton = stage.querySelector('#launchGame, #launchGameBottom');
    if (!launchButton || launching) return;

    const aiFailed = sourceSelect?.value === 'ai' && /IA indisponible|Banque locale utilisée|Contrôle qualité insuffisant/i.test(status.textContent);
    if (aiFailed) {
      document.body.classList.remove('quiz-auto-launching');
      stage.innerHTML = '<div class="generation-error-card"><strong>⚠️ Partie non lancée</strong><div>Gemini n’a pas validé assez de questions fiables. Relance la génération : aucune question locale n’a été lancée automatiquement.</div></div>';
      normalizeButtonText();
      return;
    }

    launching = true;
    document.body.classList.add('quiz-auto-launching');
    status.textContent = 'Questions contrôlées. Lancement de la partie…';
    status.style.color = '#7bf8d3';

    requestAnimationFrame(() => {
      launchButton.click();
      setTimeout(() => {
        document.body.classList.remove('quiz-auto-launching');
        launching = false;
        normalizeButtonText();
      }, 500);
    });
  }

  const stageObserver = new MutationObserver(handlePreview);
  stageObserver.observe(stage, { childList: true, subtree: true });

  const buttonObserver = new MutationObserver(normalizeButtonText);
  buttonObserver.observe(startButton, { childList: true, attributes: true, attributeFilter: ['disabled'] });

  normalizeButtonText();
  handlePreview();
})();
