const crypto = require('crypto');

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Méthode non autorisée.' });
    return;
  }

  const expectedPin = String(process.env.HOST_PIN || '2580').trim();
  const suppliedPin = String(req.body?.pin || '').trim();

  if (!/^\d{4}$/.test(suppliedPin)) {
    res.status(400).json({ ok: false, error: 'Le code doit contenir exactement 4 chiffres.' });
    return;
  }

  if (!safeEqual(suppliedPin, expectedPin)) {
    res.status(401).json({ ok: false, error: 'Code PIN incorrect.' });
    return;
  }

  res.status(200).json({ ok: true });
};
