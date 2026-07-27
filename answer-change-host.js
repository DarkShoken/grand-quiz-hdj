(() => {
  const G = window.GrandQuiz;
  if (!G || typeof G.createTransport !== 'function') return;

  const NativeMap = window.Map;
  const nativeGet = NativeMap.prototype.get;
  const nativeSet = NativeMap.prototype.set;
  let playersMap = null;
  let answersMap = null;
  let capturedMaps = 0;
  let latestHostState = null;

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
          const deadline = Number(latestHostState?.deadline) || 0;
          const closed = latestHostState?.phase !== 'question' || (deadline > 0 && Date.now() >= deadline);
          if (closed) {
            transport?.send('answer_ack', {
              playerId: message.payload?.playerId,
              questionId: message.payload?.questionId,
              accepted: false,
              reason: 'closed',
            });
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
          latestHostState = payload;
          if (answersMap) {
            payload.playerAnswers = Object.fromEntries(
              [...answersMap.entries()].map(([playerId, answer]) => [playerId, answer?.value]),
            );
          }
        }
        return originalSend(type, payload);
      };
    }

    return transport;
  };
})();
