(() => {
  const G = window.GrandQuiz;
  if (!G || typeof G.createTransport !== 'function') return;

  const NativeMap = window.Map;
  const nativeGet = NativeMap.prototype.get;
  const nativeSet = NativeMap.prototype.set;
  const nativeDelete = NativeMap.prototype.delete;
  let playersMap = null;
  let answersMap = null;
  let capturedMaps = 0;
  let latestHostState = null;
  let activeQuestionId = null;
  let activeBuzzerPlayerId = null;
  let renderQueued = false;

  function isWrittenBuzzer(state = latestHostState) {
    return ['buzzer', 'free', 'text'].includes(state?.question?.type);
  }

  function scheduleBuzzerAnswerRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderBuzzerAnswer();
    });
  }

  function renderBuzzerAnswer() {
    const stage = document.getElementById('hostStage');
    if (!stage) return;

    const existing = stage.querySelector('.host-buzzer-answer');
    const playerId = latestHostState?.buzzedPlayerId || activeBuzzerPlayerId;
    const answer = playerId && answersMap ? nativeGet.call(answersMap, playerId) : null;
    const shouldShow = latestHostState?.phase === 'question' && isWrittenBuzzer() && playerId && answer?.value;

    if (!shouldShow) {
      existing?.remove();
      return;
    }

    const feedback = stage.querySelector('.feedback');
    if (!feedback) return;

    let card = existing;
    if (!card) {
      card = document.createElement('div');
      card.className = 'host-buzzer-answer';
      card.innerHTML = '<span>Réponse envoyée</span><strong></strong>';
      feedback.appendChild(card);
    }
    const value = String(answer.value || '').trim();
    const strong = card.querySelector('strong');
    if (strong && strong.textContent !== value) strong.textContent = value;
  }

  function installAnswerReplacement() {
    if (!playersMap || !answersMap) return;

    Object.defineProperty(answersMap, 'has', {
      configurable: true,
      value() {
        // Le moteur historique bloque toute deuxième réponse avec Map.has().
        // On l’autorise ici : Map.set() remplacera ensuite la réponse précédente.
        return false;
      },
    });

    Object.defineProperty(answersMap, 'set', {
      configurable: true,
      value(playerId, nextAnswer) {
        const previousAnswer = nativeGet.call(this, playerId);
        if (previousAnswer) {
          const player = nativeGet.call(playersMap, playerId);
          if (player) {
            // Retire les points de l’ancienne réponse avant que le moteur
            // n’ajoute ceux de la nouvelle. Le bonus rapidité est ainsi
            // recalculé d’après l’heure de la dernière modification.
            player.score = Math.max(0, (Number(player.score) || 0) - (Number(previousAnswer.points) || 0));
          }
          if (nextAnswer && typeof nextAnswer === 'object') {
            nextAnswer.revisions = (Number(previousAnswer.revisions) || 0) + 1;
          }
        } else if (nextAnswer && typeof nextAnswer === 'object') {
          nextAnswer.revisions = 0;
        }
        return nativeSet.call(this, playerId, nextAnswer);
      },
    });
  }

  class CapturedMap extends NativeMap {
    constructor(iterable) {
      super(iterable);
      capturedMaps += 1;
      if (capturedMaps === 1) playersMap = this;
      if (capturedMaps === 2) {
        answersMap = this;
        installAnswerReplacement();
        window.Map = NativeMap;
      }
    }
  }

  // host-v2.js crée d’abord la Map des joueurs, puis celle des réponses.
  window.Map = CapturedMap;

  const originalCreateTransport = G.createTransport.bind(G);
  G.createTransport = function createTransportWithEditableAnswers(options = {}) {
    let transport = null;
    const originalOnMessage = options.onMessage;
    const wrappedOptions = {
      ...options,
      onMessage(message) {
        if (options.role === 'host' && message?.type === 'answer') {
          const payload = message.payload || {};
          const deadline = Number(latestHostState?.deadline) || 0;
          const closed = latestHostState?.phase !== 'question' || (deadline > 0 && Date.now() >= deadline);
          if (closed) {
            transport?.send('answer_ack', {
              playerId: payload.playerId,
              questionId: payload.questionId,
              accepted: false,
              reason: 'closed',
            });
            return;
          }

          if (isWrittenBuzzer()) {
            const playerId = payload.playerId;
            const answerText = String(payload.value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
            const lockedBy = activeBuzzerPlayerId || latestHostState?.buzzedPlayerId || null;

            if (!playerId || !answerText) {
              transport?.send('answer_ack', {
                playerId,
                questionId: payload.questionId,
                accepted: false,
                reason: 'empty',
              });
              return;
            }

            if (lockedBy && lockedBy !== playerId) {
              transport?.send('answer_ack', {
                playerId,
                questionId: payload.questionId,
                accepted: false,
                reason: 'locked',
              });
              return;
            }

            const previous = answersMap ? nativeGet.call(answersMap, playerId) : null;
            const nextAnswer = {
              value: answerText,
              answeredAt: Date.now(),
              elapsed: Math.max(0, Date.now() - (Number(latestHostState?.startedAt) || Date.now())),
              revisions: previous ? (Number(previous.revisions) || 0) + 1 : 0,
              points: 0,
            };
            if (answersMap) nativeSet.call(answersMap, playerId, nextAnswer);
            activeBuzzerPlayerId = playerId;

            transport?.send('answer_ack', {
              playerId,
              questionId: payload.questionId,
              accepted: true,
            });

            if (!latestHostState?.buzzedPlayerId) {
              originalOnMessage?.({
                ...message,
                type: 'buzz',
                payload: { ...payload, value: answerText },
              });
            } else {
              scheduleBuzzerAnswerRender();
            }
            return;
          }
        }
        originalOnMessage?.(message);
      },
    };

    transport = originalCreateTransport(wrappedOptions);

    if (options.role === 'host') {
      const originalSend = transport.send.bind(transport);
      transport.send = (type, payload = {}) => {
        if (type === 'state' && payload && typeof payload === 'object') {
          const nextQuestionId = payload.question?.id || null;
          if (nextQuestionId !== activeQuestionId) {
            activeQuestionId = nextQuestionId;
            activeBuzzerPlayerId = null;
          }

          if (payload.phase === 'question' && isWrittenBuzzer(payload)) {
            if (payload.buzzedPlayerId) {
              activeBuzzerPlayerId = payload.buzzedPlayerId;
            } else if (activeBuzzerPlayerId) {
              if (answersMap) nativeDelete.call(answersMap, activeBuzzerPlayerId);
              activeBuzzerPlayerId = null;
            }
          }

          latestHostState = payload;
          if (answersMap) {
            payload.playerAnswers = Object.fromEntries(
              [...answersMap.entries()].map(([playerId, answer]) => [playerId, answer?.value]),
            );
          }
          scheduleBuzzerAnswerRender();
        }
        return originalSend(type, payload);
      };
    }

    return transport;
  };

  const observer = new MutationObserver(scheduleBuzzerAnswerRender);
  const startObserver = () => observer.observe(document.body, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  else startObserver();
})();
