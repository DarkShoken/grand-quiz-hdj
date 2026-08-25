(() => {
  let scheduledFrame = null;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function visibleItems(root, selector) {
    return [...root.querySelectorAll(selector)]
      .filter((item) => item.clientWidth > 0 && item.clientHeight > 0);
  }

  function prepareAnswerWrapping(items) {
    items.forEach((item) => {
      const text = String(item.textContent || '').replace(/\s+/g, ' ').trim();
      const singleWord = text.length > 0 && !text.includes(' ');

      item.style.wordBreak = 'normal';
      item.style.overflowWrap = 'normal';
      item.style.hyphens = 'none';
      item.style.whiteSpace = singleWord ? 'nowrap' : 'normal';
      item.style.setProperty('text-wrap', singleWord ? 'nowrap' : 'balance');
    });
  }

  function setFont(items, size, lineHeight = 1.02) {
    items.forEach((item) => {
      item.style.fontSize = `${size}px`;
      item.style.lineHeight = String(lineHeight);
    });
  }

  function hasTinyOrphan(item) {
    if (item.style.whiteSpace === 'nowrap') return false;

    const textNode = [...item.childNodes].find((node) =>
      node.nodeType === Node.TEXT_NODE && String(node.textContent || '').trim()
    );
    if (!textNode) return false;

    const text = String(textNode.textContent || '');
    const words = [...text.matchAll(/\S+/g)];
    if (words.length < 2) return false;

    const previous = words[words.length - 2];
    const last = words[words.length - 1];
    if (last[0].length > 2) return false;

    try {
      const previousRange = document.createRange();
      previousRange.setStart(textNode, previous.index);
      previousRange.setEnd(textNode, previous.index + previous[0].length);
      const lastRange = document.createRange();
      lastRange.setStart(textNode, last.index);
      lastRange.setEnd(textNode, last.index + last[0].length);

      const previousRect = previousRange.getBoundingClientRect();
      const lastRect = lastRange.getBoundingClientRect();
      return lastRect.top > previousRect.top + 2;
    } catch {
      return false;
    }
  }

  function itemsFit(items) {
    return items.every((item) =>
      item.scrollHeight <= item.clientHeight + 1 &&
      item.scrollWidth <= item.clientWidth + 1 &&
      !hasTinyOrphan(item)
    );
  }

  function largestFont(items, minSize, maxSize, lineHeight = 1.02) {
    if (!items.length) return minSize;
    prepareAnswerWrapping(items);
    setFont(items, minSize, lineHeight);

    let low = minSize;
    let high = maxSize;
    let best = minSize;

    while (high - low > 0.35) {
      const middle = (low + high) / 2;
      setFont(items, middle, lineHeight);
      if (itemsFit(items)) {
        best = middle;
        low = middle;
      } else {
        high = middle;
      }
    }

    best = Math.floor(best * 10) / 10;
    setFont(items, best, lineHeight);
    return best;
  }

  function shrinkUntilCardFits(card, question, answerItems, questionSize, answerSize) {
    let qSize = questionSize;
    let aSize = answerSize;
    let attempts = 0;

    while ((card.scrollHeight > card.clientHeight + 1 || !itemsFit(answerItems)) && attempts < 24) {
      qSize = Math.max(24, qSize * 0.96);
      aSize = Math.max(24, aSize * 0.96);
      setFont([question], qSize, 1.02);
      setFont(answerItems, aSize, 1.02);
      attempts += 1;
    }

    return { questionSize: qSize, answerSize: aSize };
  }

  function fitTvQuestionCard(card) {
    const question = card.querySelector('.question-text');
    const grid = card.querySelector('.answer-grid');
    const answerItems = grid ? visibleItems(grid, ':scope > .answer-tile') : [];
    if (!question || !grid || !answerItems.length) return;

    prepareAnswerWrapping(answerItems);

    const stage = card.parentElement;
    const meta = card.querySelector('.question-meta');
    const timer = card.querySelector('.timer-wrap');
    const isReveal = card.classList.contains('reveal-card');
    const viewportHeight = Math.max(480, window.innerHeight || 720);
    const viewportWidth = Math.max(640, window.innerWidth || 1280);

    question.style.display = 'grid';
    question.style.placeItems = 'center';
    question.style.width = '100%';
    question.style.overflow = 'hidden';

    if (isReveal) {
      const answerMax = Math.min(62, viewportHeight * 0.058, viewportWidth * 0.045);
      const answerMin = Math.max(24, Math.min(34, viewportHeight * 0.033));
      const answerSize = largestFont(answerItems, answerMin, answerMax);
      const questionTarget = clamp(answerSize * 0.88, 28, 52);
      question.style.height = 'auto';
      question.style.fontSize = `${questionTarget}px`;
      question.style.lineHeight = '1.03';
      return;
    }

    const cardStyle = getComputedStyle(card);
    const paddingY = parseFloat(cardStyle.paddingTop || 0) + parseFloat(cardStyle.paddingBottom || 0);
    const stageHeight = Math.max(360, stage?.clientHeight || card.clientHeight || viewportHeight * 0.82);
    const metaHeight = meta?.getBoundingClientRect().height || 0;
    const timerHeight = timer?.getBoundingClientRect().height || 0;
    const structuralGaps = clamp(stageHeight * 0.025, 14, 24);
    const available = Math.max(250, stageHeight - paddingY - metaHeight - timerHeight - structuralGaps);

    const questionLength = question.textContent.trim().length;
    const longestAnswer = Math.max(...answerItems.map((item) => item.textContent.trim().length), 1);
    const answerCount = answerItems.length;

    let questionShare = 0.34;
    if (questionLength > 105) questionShare = 0.43;
    else if (questionLength > 78) questionShare = 0.39;
    else if (questionLength > 52) questionShare = 0.36;
    else if (questionLength < 35) questionShare = 0.31;

    if (longestAnswer > 55) questionShare -= 0.035;
    else if (longestAnswer < 24) questionShare += 0.025;
    if (answerCount <= 2) questionShare = Math.max(questionShare, 0.43);
    questionShare = clamp(questionShare, 0.29, 0.46);

    const contentGap = clamp(stageHeight * 0.012, 8, 14);
    let questionHeight = Math.round(available * questionShare);
    questionHeight = clamp(questionHeight, 92, Math.max(92, available - 190));
    const gridHeight = Math.max(170, available - questionHeight - contentGap);

    question.style.height = `${questionHeight}px`;
    question.style.marginTop = '0';
    question.style.marginBottom = `${contentGap}px`;
    grid.style.height = `${gridHeight}px`;
    grid.style.maxHeight = 'none';

    const questionMin = Math.max(30, Math.min(40, viewportHeight * 0.04));
    const questionMax = Math.min(76, viewportHeight * 0.078, viewportWidth * 0.06);
    const answerMin = Math.max(24, Math.min(38, viewportHeight * 0.04));
    const answerMax = Math.min(88, viewportHeight * 0.09, viewportWidth * 0.065);

    let questionSize = largestFont([question], questionMin, questionMax, 1.02);
    let answerSize = largestFont(answerItems, answerMin, answerMax, 1.02);

    const answerCeiling = questionSize * 1.25;
    if (answerSize > answerCeiling) {
      answerSize = answerCeiling;
      setFont(answerItems, answerSize, 1.02);
    }

    const questionCeiling = answerSize * 1.16;
    if (questionSize > questionCeiling) {
      questionSize = questionCeiling;
      setFont([question], questionSize, 1.02);
    }

    shrinkUntilCardFits(card, question, answerItems, questionSize, answerSize);
  }

  function fitMobileCard(grid) {
    const answerItems = visibleItems(grid, ':scope > .mobile-option');
    if (!answerItems.length) return;

    prepareAnswerWrapping(answerItems);

    const viewportWidth = Math.max(320, window.innerWidth || 390);
    const answerMin = Math.max(21, Math.min(28, viewportWidth * 0.062));
    const answerMax = Math.max(38, Math.min(58, viewportWidth * 0.13));
    const answerSize = largestFont(answerItems, answerMin, answerMax, 1.03);

    const card = grid.closest('.player-card');
    const question = card?.querySelector('.mobile-question');
    if (question) {
      const questionSize = clamp(answerSize * 0.82, 28, 46);
      question.style.fontSize = `${questionSize}px`;
      question.style.lineHeight = '1.08';
    }
  }

  function fitAll() {
    scheduledFrame = null;

    document.querySelectorAll('.question-card').forEach(fitTvQuestionCard);
    document.querySelectorAll('.mobile-options').forEach(fitMobileCard);
  }

  function scheduleFit() {
    if (scheduledFrame !== null) cancelAnimationFrame(scheduledFrame);
    scheduledFrame = requestAnimationFrame(() => {
      requestAnimationFrame(fitAll);
    });
  }

  const TIMER_SELECTORS = '.timer-wrap, .reveal-auto-countdown, .host-auto-next, #timerValue, #tvRevealTimer, #hostRevealTimer';

  const observer = new MutationObserver((mutations) => {
    const shouldRefit = mutations.some((mutation) => {
      const rawTarget = mutation.target;
      const target = rawTarget?.nodeType === Node.ELEMENT_NODE ? rawTarget : rawTarget?.parentElement;
      if (!target) return false;

      // Les chronos changent très souvent. Ils ne modifient pas la géométrie utile
      // de la question et ne doivent surtout pas relancer le coûteux calcul de fontes.
      if (target.closest?.(TIMER_SELECTORS)) return false;

      if (target.matches?.('#stage') || target.closest?.('#stage, .player-card')) return true;

      const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
      return nodes.some((node) =>
        node.nodeType === Node.ELEMENT_NODE && (
          node.matches?.('.question-card, .player-card, .mobile-options') ||
          node.querySelector?.('.question-card, .player-card, .mobile-options')
        )
      );
    });

    if (shouldRefit) scheduleFit();
  });

  function start() {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    scheduleFit();
    document.fonts?.ready?.then(scheduleFit).catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.addEventListener('resize', scheduleFit);
  window.addEventListener('orientationchange', scheduleFit);
  window.GrandQuizAnswerFit = { fit: scheduleFit };
})();