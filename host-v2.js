(() => {
  // Safety bootstrap: the full host controller is pinned to the last known-good
  // immutable Vercel deployment while the production link migration is applied.
  const src = 'https://grand-quiz-9p3g3xk7t-infernals.vercel.app/host-v2.js';
  const script = document.createElement('script');
  script.src = src;
  script.async = false;
  document.currentScript?.after(script);
})();
