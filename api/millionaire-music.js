const fs = require('fs');
const path = require('path');

let cachedAudio = null;

function loadAudio() {
  if (cachedAudio) return cachedAudio;

  const sourcePath = path.join(process.cwd(), 'millionaire-audio-data.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const match = source.match(/base64,([^']+)'/);
  if (!match?.[1]) throw new Error('Millionaire audio payload not found');

  cachedAudio = Buffer.from(match[1], 'base64');
  return cachedAudio;
}

module.exports = function handler(req, res) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end();
    return;
  }

  try {
    const audio = loadAudio();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', String(audio.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Accept-Ranges', 'bytes');

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    res.end(audio);
  } catch (error) {
    console.error('Unable to serve quiz music', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Audio unavailable');
  }
};
