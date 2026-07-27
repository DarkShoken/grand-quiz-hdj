(() => {
  const NativeMutationObserver = window.MutationObserver;
  if (!NativeMutationObserver) return;

  function mutationElement(record) {
    if (record.target?.nodeType === Node.TEXT_NODE) return record.target.parentElement;
    return record.target instanceof Element ? record.target : null;
  }

  function isCosmeticMutation(record) {
    const element = mutationElement(record);
    return Boolean(element?.closest('.answer-status, #numericBtn'));
  }

  window.MutationObserver = class FilteredMutationObserver extends NativeMutationObserver {
    constructor(callback) {
      super((records, observer) => {
        const relevant = records.filter((record) => !isCosmeticMutation(record));
        if (relevant.length) callback(relevant, observer);
      });
    }
  };
})();
