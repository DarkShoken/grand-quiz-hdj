(() => {
  const stage = document.getElementById('stage');
  if (!stage) return;

  function clean(root = stage) {
    const scope = root.nodeType === Node.ELEMENT_NODE ? root : stage;

    if (scope.matches?.('.question-meta,.question-side-meta,.question-side-pill')) scope.remove();
    scope.querySelectorAll?.('.question-meta,.question-side-meta,.question-side-pill').forEach((node) => node.remove());

    scope.querySelectorAll?.('.badge').forEach((node) => {
      if (node.closest('#stage')) node.remove();
    });
  }

  clean();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (
          node.matches?.('.question-meta,.question-side-meta,.question-side-pill,.badge') ||
          node.querySelector?.('.question-meta,.question-side-meta,.question-side-pill,.badge')
        ) {
          clean(node);
        }
      }
    }
  });

  observer.observe(stage, { childList: true, subtree: true });
})();
