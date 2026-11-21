import crypto from 'node:crypto';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import cors from 'cors';
import express from 'express';
import geoip from 'geoip-lite';
import maxmind from 'maxmind';
import { rateLimit } from 'express-rate-limit';
import mongoose from 'mongoose';
import { createClient } from 'redis';

const { MONGODB_URI, REDIS_URL, FRONTEND_ORIGIN, PUBLIC_API_URL, NODE_ENV } = process.env;
if (!MONGODB_URI || !FRONTEND_ORIGIN || !PUBLIC_API_URL) {
  throw new Error('Set MONGODB_URI, FRONTEND_ORIGIN and PUBLIC_API_URL before starting.');
}

const Link = mongoose.model('Link', new mongoose.Schema({
  code: { type: String, unique: true, required: true },
  url: { type: String, required: true },
  createdCity: { type: String, default: null },
  createdCountry: { type: String, default: null },
  ownerHash: { type: String, required: true },
}, { timestamps: true }));
const clickSchema = new mongoose.Schema({
  code: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  city: { type: String, default: null },
  country: { type: String, default: null },
  region: { type: String, default: null },
  referrer: { type: String, default: 'Direct' },
});
clickSchema.index({ code: 1, timestamp: -1 });
const Click = mongoose.model('Click', clickSchema);
await mongoose.connect(MONGODB_URI);
await Promise.all([Link.init(), Click.init()]);

const cache = REDIS_URL ? createClient({
  url: REDIS_URL,
  disableOfflineQueue: true,
  socket: { connectTimeout: 3000 },
}) : null;
if (cache) {
  cache.on('error', (error) => console.warn('Redis:', error.message));
  cache.connect().catch((error) => console.warn('Redis:', error.message));
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.RENDER === 'true' ? 1 : false);
app.use(cors({ origin: FRONTEND_ORIGIN, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '4kb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many requests. Try again shortly.' } }));

// IP Geolocation by DB-IP (https://db-ip.com), CC BY 4.0.
const cityDatabase = await readFile(new URL('../node_modules/dbip-city-lite/dbip-city-lite.mmdb.gz', import.meta.url))
  .then((compressed) => new maxmind.Reader(gunzipSync(compressed)))
  .catch((error) => {
    console.warn('Optional city database unavailable:', error.message);
    return null;
  });

const codeValid = (code) => /^[A-Za-z0-9_-]{3,32}$/.test(code);
function approximateLocation(req) {
  const onRender = Boolean(process.env.RENDER_SERVICE_ID || process.env.RENDER === 'true');
  const forwarded = onRender ? (req.get('x-forwarded-for') || '').split(',').map((ip) => ip.trim()) : [];
  // On Render the visitor can appear ahead of the edge and internal proxy hops.
  const addresses = onRender
    ? [req.get('cf-connecting-ip'), req.get('true-client-ip'), forwarded.at(-3), req.ip]
    : [req.ip];
  for (const address of new Set(addresses)) {
    if (!address || !isIP(address)) continue;
    const ip = address.replace(/^::ffff:(?=\d+\.)/i, '');
    const place = geoip.lookup(ip);
    if (place?.city && place.country) return { city: place.city, country: place.country };
    const alternate = cityDatabase?.get(ip);
    const country = alternate?.country?.iso_code || place?.country;
    if (country) return { city: alternate?.city?.names?.en || null, country };
  }
  const country = onRender ? req.get('cf-ipcountry') : undefined;
  return { city: null, country: /^[A-Z]{2}$/.test(country || '') && country !== 'XX' ? country : null };
}

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const shortUrl = (code) => new URL('/s/' + code, PUBLIC_API_URL).href;
const verifyUrl = (value) => {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
};

app.get('/api/health', (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ database: ready ? 'connected' : 'unavailable', cache: cache?.isReady ? 'connected' : 'unavailable' });
});

app.post('/api/links', rateLimit({ windowMs: 60_000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Link creation limit reached. Try again in a minute.' } }), async (req, res) => {
  const { url, alias } = req.body ?? {};
  const destination = verifyUrl(url);
  if (!destination) return res.status(400).json({ error: 'Enter a valid HTTP or HTTPS URL.' });
  if (alias && (typeof alias !== 'string' || !codeValid(alias))) {
    return res.status(400).json({ error: 'Use 3–32 letters, numbers, hyphens or underscores for the alias.' });
  }
  const { city: createdCity, country: createdCountry } = approximateLocation(req);
  const ownerToken = crypto.randomBytes(32).toString('base64url');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const code = alias || crypto.randomBytes(6).toString('base64url');
    try {
      const link = await Link.create({ code, url: destination, createdCity, createdCountry, ownerHash: hash(ownerToken) });
      res.set('Cache-Control', 'no-store');
      return res.status(201).json({ code, url: destination, shortUrl: shortUrl(code), createdAt: link.createdAt, createdCity, createdCountry, ownerToken });
    } catch (error) {
      if (error.code !== 11000) throw error;
      if (alias) return res.status(409).json({ error: 'That alias is already in use.' });
    }
  }
  return res.status(503).json({ error: 'Could not generate a unique code. Try again.' });
});

async function cacheCall(command) {
  if (!cache?.isReady) return null;
  try {
    return await command(AbortSignal.timeout(350));
  } catch {
    return null;
  }
}

async function destinationFor(code) {
  if (!codeValid(code)) return null;
  const key = 'linkmetric:v1:' + code;
  const cached = await cacheCall((signal) => cache.withCommandOptions({ abortSignal: signal }).get(key));
  if (cached) return cached;
  const link = await Link.findOne({ code }).select('url').lean();
  if (!link) return null;
  await cacheCall((signal) => cache.withCommandOptions({ abortSignal: signal }).set(key, link.url, { EX: 900 }));
  return link.url;
}

async function recordVisit(req, code, region = null, sharedCity = null) {
  let referrer = 'Direct';
  try {
    const source = new URL(req.get('referer'));
    if (source.origin !== new URL(FRONTEND_ORIGIN).origin) referrer = source.hostname.slice(0, 253);
  } catch {
    // Direct navigation commonly has no referrer.
  }
  try {
    const location = approximateLocation(req);
    await Click.create({ code, ...location, city: sharedCity || location.city, region, referrer });
  } catch (error) {
    console.error('Click persistence failed:', error.message);
  }
}

app.get('/s/:code', async (req, res) => {
  const { code } = req.params;
  const url = await destinationFor(code);
  if (!url) return res.status(404).type('text/plain').send('Short link not found.');
  if (req.method === 'GET') await recordVisit(req, code);
  return res.set('Cache-Control', 'no-store').redirect(302, url);
});

app.post('/api/visit/:code', async (req, res) => {
  const { code } = req.params;
  const url = await destinationFor(code);
  if (!url) return res.status(404).json({ error: 'Short link not found.' });
  const { latitude, longitude, city } = req.body ?? {};
  const sharedCity = typeof city === 'string' ? city.trim().replace(/\s+/g, ' ') : '';
  if (sharedCity && (sharedCity.length > 80 || !/^[\p{L}\p{M}\p{N} .'’()-]+$/u.test(sharedCity))) {
    return res.status(400).json({ error: 'Enter a valid city name.' });
  }
  const valid = Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
  const region = valid ? Math.round(latitude) + '°, ' + Math.round(longitude) + '°' : null;
  await recordVisit(req, code, region, sharedCity);
  return res.set('Cache-Control', 'no-store').json({ url });
});

app.get('/api/analytics/:code', async (req, res) => {
  const { code } = req.params;
  const token = req.get('authorization')?.match(/^Bearer ([\w-]{43})$/)?.[1];
  res.set('Cache-Control', 'no-store');
  if (!token || !codeValid(code) || !await Link.exists({ code, ownerHash: hash(token) })) {
    return res.status(404).json({ error: 'Analytics are unavailable for this link.' });
  }
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - 6);
  const [stats] = await Click.aggregate([
    { $match: { code } },
    { $facet: {
      total: [{ $count: 'count' }],
      days: [{ $match: { timestamp: { $gte: start } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, count: { $sum: 1 } } }],
      locations: [{ $match: { $or: [{ country: { $ne: null } }, { region: { $ne: null } }] } }, { $group: { _id: { city: { $ifNull: ['$city', null] }, country: { $ifNull: ['$country', null] }, region: { $cond: [{ $ifNull: ['$country', false] }, null, '$region'] } }, count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }],
      recent: [{ $sort: { timestamp: -1 } }, { $limit: 10 }, { $project: { _id: 0, timestamp: 1, city: 1, country: 1, region: 1, referrer: 1 } }],
    } },
  ]);
  res.json({ total: stats.total[0]?.count ?? 0, days: stats.days, locations: stats.locations, recent: stats.recent });
});

app.use((error, _req, res, _next) => {
  if (error.status === 400 || error.status === 413) return res.status(error.status).json({ error: 'Invalid request body.' });
  console.error(error.message);
  return res.status(500).json({ error: 'The service could not complete your request.' });
});

app.listen(process.env.PORT || 3000, () => console.log('URL Shortener with Integrated Analytics Dashboard API started in', NODE_ENV || 'development'));
