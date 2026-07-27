(() => {
  const bank = window.GRAND_QUIZ_QUESTIONS;
  if (!Array.isArray(bank)) return;

  function shuffleMcq(question) {
    if (!question || question.type !== 'mcq' || !Array.isArray(question.options) || question.options.length < 2) return question;
    const correctIndex = Number(question.answer);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= question.options.length) return question;

    const entries = question.options.map((text, index) => ({ text, correct: index === correctIndex }));
    for (let index = entries.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [entries[index], entries[swapIndex]] = [entries[swapIndex], entries[index]];
    }

    question.options = entries.map((entry) => entry.text);
    question.answer = entries.findIndex((entry) => entry.correct);
    return question;
  }

  bank.forEach(shuffleMcq);
})();
