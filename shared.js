(() => {
  const cleanRoom = (value) => (value || 'QUIZ01')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 16) || 'QUIZ01';

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  function hasSupabaseConfig() {
    const cfg = window.BLIND_TEST_CONFIG || {};
    return Boolean(
      window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
      !cfg.SUPABASE_URL.includes('VOTRE-PROJET') && !cfg.SUPABASE_ANON_KEY.includes('VOTRE_CLE')
    );
  }

  function createTransport({ room, role, onMessage, onStatus }) {
    const safeRoom = cleanRoom(room);
    const clientId = uid();
    let channel = null;
    let bc = null;
    let ready = false;
    let closed = false;
    const pending = [];

    const envelope = (type, payload = {}) => ({
      id: uid(), room: safeRoom, role, clientId, type, payload, sentAt: Date.now()
    });

    const deliver = (message) => {
      if (!message || message.room !== safeRoom || message.clientId === clientId) return;
      onMessage?.(message);
    };

    if (hasSupabaseConfig()) {
      const cfg = window.BLIND_TEST_CONFIG;
      const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        realtime: { params: { eventsPerSecond: 30 } }
      });
      const sendEnvelope = (message) => channel.send({ type: 'broadcast', event: 'message', payload: message });
      const flush = async () => {
        while (pending.length && ready && !closed) {
          const item = pending.shift();
          try { item.resolve(await sendEnvelope(item.message)); } catch { item.resolve(false); }
        }
      };
      channel = sb.channel(`grand-quiz-${safeRoom}`, { config: { broadcast: { self: false, ack: true } } });
      channel.on('broadcast', { event: 'message' }, ({ payload }) => deliver(payload))
        .subscribe((status, error) => {
          ready = status === 'SUBSCRIBED';
          onStatus?.({ mode: 'online', status, ready, error: error || null });
          if (ready) { sendEnvelope(envelope('hello')); flush(); }
        });
      return {
        room: safeRoom, role, clientId, mode: 'online',
        send(type, payload = {}) {
          if (closed || !channel) return Promise.resolve(false);
          const message = envelope(type, payload);
          if (!ready) return new Promise((resolve) => pending.push({ message, resolve }));
          return sendEnvelope(message).catch(() => false);
        },
        close() {
          closed = true;
          while (pending.length) pending.shift().resolve(false);
          if (channel) sb.removeChannel(channel);
        },
        get ready() { return ready; }
      };
    }

    bc = new BroadcastChannel(`grand-quiz-${safeRoom}`);
    bc.onmessage = (event) => deliver(event.data);
    ready = true;
    onStatus?.({ mode: 'demo-local', status: 'SUBSCRIBED', ready: true, error: null });
    setTimeout(() => bc.postMessage(envelope('hello')), 30);
    return {
      room: safeRoom, role, clientId, mode: 'demo-local',
      send(type, payload = {}) { bc.postMessage(envelope(type, payload)); return Promise.resolve(true); },
      close() { bc.close(); },
      get ready() { return ready; }
    };
  }

  function qs(name, fallback = '') { return new URLSearchParams(location.search).get(name) || fallback; }
  function setRoomInUrl(room) {
    const url = new URL(location.href);
    url.searchParams.set('room', cleanRoom(room));
    history.replaceState({}, '', url);
  }
  function makePlayUrl(room) {
    return new URL(`play.html?room=${encodeURIComponent(cleanRoom(room))}`, location.href).href;
  }
  function makeHostUrl(room) {
    return new URL(`host.html?room=${encodeURIComponent(cleanRoom(room))}`, location.href).href;
  }
  function shuffle(array) {
    const a = [...array];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
  }
  function confetti(count = 70) {
    const colors = ['#ff4d6d','#ffd166','#06d6a0','#4cc9f0','#9b5de5','#ffffff'];
    for (let i = 0; i < count; i += 1) {
      const piece = document.createElement('i');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}vw`;
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDuration = `${1.6 + Math.random() * 2.6}s`;
      piece.style.animationDelay = `${Math.random() * .35}s`;
      document.body.appendChild(piece);
      setTimeout(() => piece.remove(), 5000);
    }
  }

  window.GrandQuiz = { cleanRoom, uid, createTransport, qs, setRoomInUrl, makePlayUrl, makeHostUrl, shuffle, escapeHtml, confetti, hasSupabaseConfig };
})();
