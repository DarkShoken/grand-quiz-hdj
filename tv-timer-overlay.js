(() => {
  const style = document.createElement('style');
  style.textContent = `
    #gameCountdownOverlay {
      position: fixed;
      left: 50%;
      bottom: 54px;
      transform: translateX(-50%);
      z-index: 20000;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 9px 16px 9px 10px;
      border-radius: 999px;
      background: rgba(7, 8, 23, .97);
      border: 2px solid rgba(76, 201, 240, .55);
      box-shadow: 0 10px 34px rgba(0,0,0,.5);
      color: #fff;
      pointer-events: none;
      font-family: inherit;
    }
    #gameCountdownOverlay.hidden {
      display: none !important;
    }
    #gameCountdownOverlay.reveal {
      border-color: rgba(255, 209, 102, .7);
    }
    #gameCountdownValue {
      width: 58px;
      height: 58px;
      flex: 0 0 58px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      border: 5px solid #4cc9f0;
      background: rgba(76,201,240,.15);
      color: #fff;
      font-size: 27px;
      line-height: 1;
      font-weight: 1000;
      box-sizing: border-box;
    }
    #gameCountdownOverlay.reveal #gameCountdownValue {
      border-color: #ffd166;
      background: rgba(255,209,102,.15);
    }
    #gameCountdownLabel {
      font-size: 18px;
      font-weight: 950;
      white-space: nowrap;
    }
    @media (max-width: 760px) {
      #gameCountdownOverlay {
        bottom: 10px;
        padding: 6px 11px 6px 7px;
        gap: 8px;
      }
      #gameCountdownValue {
        width: 48px;
        height: 48px;
        flex-basis: 48px;
        border-width: 4px;
        font-size: 22px;
      }
      #gameCountdownLabel {
        font-size: 14px;
      }
    }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'gameCountdownOverlay';
  overlay.className = 'hidden';
  overlay.innerHTML = `
    <div id="gameCountdownValue">—</div>
    <div id="gameCountdownLabel">Temps restant</div>
  `;
  document.body.appendChild(overlay);

  const value = document.getElementById('gameCountdownValue');
  const label = document.getElementById('gameCountdownLabel');

  function visible(node) {
    if (!node) return false;
    const style = getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function update() {
    const gameView = document.getElementById('gameView');
    if (!gameView || gameView.classList.contains('hidden')) {
      overlay.classList.add('hidden');
      return;
    }

    const questionTimer = document.getElementById('timerValue');
    const revealTimer = document.getElementById('tvRevealTimer');

    if (questionTimer && visible(questionTimer)) {
      const text = String(questionTimer.textContent || '').trim();
      if (text) {
        value.textContent = text;
        label.textContent = 'Temps restant';
        overlay.classList.remove('reveal', 'hidden');
        return;
      }
    }

    if (revealTimer && visible(revealTimer)) {
      const text = String(revealTimer.textContent || '').trim();
      if (text) {
        value.textContent = text;
        label.textContent = 'Question suivante';
        overlay.classList.add('reveal');
        overlay.classList.remove('hidden');
        return;
      }
    }

    overlay.classList.add('hidden');
  }

  setInterval(update, 100);
  document.addEventListener('visibilitychange', update);
  window.addEventListener('focus', update);
  update();
})();