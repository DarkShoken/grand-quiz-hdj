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
            player.score = Math.max(
              0,
              (Number(player.score) || 0) - (Number(previousAnswer.points) || 0),
            );
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
  window.Map = CapturedMap;

  const originalCreateTransport = G.createTransport.bind(G);
  G.createTransport = function createTransportWithEditableAnswers(options = {}) {
    let transport = null;
    const originalOnMessage = options.onMessage;

    transport = originalCreateTransport({
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
        }
        originalOnMessage?.(message);
      },
    });

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