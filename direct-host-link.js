(() => {
  const G = window.GrandQuiz;
  const link = document.getElementById('hostDirectLink');
  if (!link) return;
  const room = G?.cleanRoom ? G.cleanRoom(G.qs('room', 'QUIZ')) : 'QUIZ';
  link.href = new URL(`host.html?room=${encodeURIComponent(room)}`, location.href).href;
})();
