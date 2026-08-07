(() => {
  const bank = window.GRAND_QUIZ_QUESTIONS;
  const media = window.GRAND_QUIZ_MEDIA_LIBRARY;
  if (!Array.isArray(bank) || !Array.isArray(media)) return;
  const ids = new Set(bank.map((q) => q?.id).filter(Boolean));
  for (const question of media) {
    if (!question?.id || ids.has(question.id)) continue;
    bank.push({ ...question, options: Array.isArray(question.options) ? [...question.options] : question.options, clues: Array.isArray(question.clues) ? [...question.clues] : question.clues, media: question.media ? { ...question.media } : question.media });
    ids.add(question.id);
  }
})();
