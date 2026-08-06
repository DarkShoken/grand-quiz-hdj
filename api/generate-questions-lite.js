// Point d’entrée de secours : il réutilise exactement les mêmes contrôles,
// le même schéma et le même prompt que generate-questions.js, mais avec
// Gemini Flash-Lite lorsque le modèle principal est momentanément saturé.
const previousModel = process.env.GEMINI_MODEL;
process.env.GEMINI_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash-lite';

const handler = require('./generate-questions');

if (previousModel === undefined) delete process.env.GEMINI_MODEL;
else process.env.GEMINI_MODEL = previousModel;

module.exports = handler;
