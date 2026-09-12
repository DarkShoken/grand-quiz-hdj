(() => {
  const G = window.GrandQuiz;
  if (!G) return;

  function cleanRoom() {
    return G.cleanRoom(document.getElementById('roomInput')?.value || G.qs('room', 'QUIZ'));
  }

  function cleanUrl() {
    const room = cleanRoom();
    const url = new URL('tv-clean.html', location.href);
    url.searchParams.set('room', room);
    url.searchParams.set('build', 'clean1');
    return url.href;
  }

  function refreshHref() {
    const link = document.getElementById('screenLink');
    if (link) link.href = cleanUrl();
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('#screenLink');
    if (!link) return;
    event.preventDefault();
    window.open(cleanUrl(), '_blank', 'noopener');
  }, true);

  document.getElementById('roomInput')?.addEventListener('input', refreshHref);
  document.getElementById('roomInput')?.addEventListener('change', refreshHref);
  refreshHref();
  setTimeout(refreshHref, 250);
  setTimeout(refreshHref, 1000);
})();