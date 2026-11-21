import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { getContext } from '@netlify/server';
import { and, count, desc, eq, gte, isNotNull, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { clicks, links } from '../../db/schema.js';

export const config = { path: ['/api/*', '/s/*'] };

const context = () => {
  try {
    return getContext();
  } catch {
    return null;
  }
};
const clientIp = (req: Request) => context()?.ip || req.ip || 'unknown';
const publicOrigin = (req: Request) => context()?.url?.origin || `${req.protocol}://${req.get('host')}`;
function approximateLocation() {
  const geo = context()?.geo;
  return { city: geo?.city || null, country: geo?.country?.code || null };
}

const limiter = (limit: number, error: string) => rateLimit({
  windowMs: 60_000,
  limit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: clientIp,
  validate: false,
  message: { error },
});

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4kb' }));
app.use(limiter(180, 'Too many requests. Try again shortly.'));

const codeValid = (code: unknown): code is string => typeof code === 'string' && /^[A-Za-z0-9_-]{3,32}$/.test(code);
const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const verifyUrl = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
};

// Per-instance cache of code -> destination. Postgres is the source of truth.
const CACHE_TTL = 15 * 60_000;
const cache = new Map<string, { url: string; expires: number }>();
function remember(code: string, url: string) {
  if (cache.size >= 5000) cache.delete(cache.keys().next().value!);
  cache.set(code, { url, expires: Date.now() + CACHE_TTL });
}

async function destinationFor(code: string) {
  if (!codeValid(code)) return null;
  const hit = cache.get(code);
  if (hit && hit.expires > Date.now()) return hit.url;
  const [link] = await db.select({ url: links.url }).from(links).where(eq(links.code, code)).limit(1);
  if (!link) return null;
  remember(code, link.url);
  return link.url;
}

async function recordVisit(req: Request, code: string, region: string | null = null) {
  let referrer = 'Direct';
  try {
    const source = new URL(req.get('referer') || '');
    if (source.origin !== publicOrigin(req)) referrer = source.hostname.slice(0, 253);
  } catch {
    // Direct navigation commonly has no referrer.
  }
  try {
    await db.insert(clicks).values({ code, ...approximateLocation(), region, referrer });
  } catch (error) {
    console.error('Click persistence failed:', (error as Error).message);
  }
}

app.get('/api/health', async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.json({ database: 'connected' });
  } catch {
    res.status(503).json({ database: 'unavailable' });
  }
});

app.post('/api/links', limiter(15, 'Link creation limit reached. Try again in a minute.'), async (req, res) => {
  const { url, alias } = req.body ?? {};
  const destination = verifyUrl(url);
  if (!destination) return res.status(400).json({ error: 'Enter a valid HTTP or HTTPS URL.' });
  if (alias && !codeValid(alias)) {
    return res.status(400).json({ error: 'Use 3–32 letters, numbers, hyphens or underscores for the alias.' });
  }
  const { city: createdCity, country: createdCountry } = approximateLocation();
  const ownerToken = crypto.randomBytes(32).toString('base64url');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const code: string = alias || crypto.randomBytes(6).toString('base64url');
    const [link] = await db.insert(links)
      .values({ code, url: destination, createdCity, createdCountry, ownerHash: hash(ownerToken) })
      .onConflictDoNothing()
      .returning({ createdAt: links.createdAt });
    if (link) {
      remember(code, destination);
      res.set('Cache-Control', 'no-store');
      return res.status(201).json({
        code, url: destination, shortUrl: new URL('/s/' + code, publicOrigin(req)).href,
        createdAt: link.createdAt, createdCity, createdCountry, ownerToken,
      });
    }
    if (alias) return res.status(409).json({ error: 'That alias is already in use.' });
  }
  return res.status(503).json({ error: 'Could not generate a unique code. Try again.' });
});

app.get('/s/:code', async (req, res) => {
  const { code } = req.params;
  const url = await destinationFor(code);
  if (!url) return res.status(404).type('text/plain').send('Short link not found.');
  await recordVisit(req, code);
  return res.set('Cache-Control', 'no-store').redirect(302, url);
});

app.post('/api/visit/:code', async (req, res) => {
  const { code } = req.params;
  const url = await destinationFor(code);
  if (!url) return res.status(404).json({ error: 'Short link not found.' });
  const { latitude, longitude } = req.body ?? {};
  const valid = Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
  const region = valid ? Math.round(latitude) + '°, ' + Math.round(longitude) + '°' : null;
  await recordVisit(req, code, region);
  return res.set('Cache-Control', 'no-store').json({ url });
});

app.get('/api/analytics/:code', async (req, res) => {
  const { code } = req.params;
  const token = req.get('authorization')?.match(/^Bearer ([\w-]{43})$/)?.[1];
  res.set('Cache-Control', 'no-store');
  const owned = token && codeValid(code) && (await db.select({ code: links.code }).from(links)
    .where(and(eq(links.code, code), eq(links.ownerHash, hash(token)))).limit(1)).length;
  if (!owned) return res.status(404).json({ error: 'Analytics are unavailable for this link.' });

  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - 6);
  const day = sql<string>`to_char(${clicks.timestamp} at time zone 'UTC', 'YYYY-MM-DD')`;
  const gpsRegion = sql<string | null>`case when ${clicks.country} is null then ${clicks.region} end`;
  const [[total], days, locations, recent] = await Promise.all([
    db.select({ count: count() }).from(clicks).where(eq(clicks.code, code)),
    db.select({ _id: day, count: count() }).from(clicks)
      .where(and(eq(clicks.code, code), gte(clicks.timestamp, start))).groupBy(day),
    db.select({ city: clicks.city, country: clicks.country, region: gpsRegion, count: count() }).from(clicks)
      .where(and(eq(clicks.code, code), or(isNotNull(clicks.country), isNotNull(clicks.region))))
      .groupBy(clicks.city, clicks.country, gpsRegion).orderBy(desc(count())).limit(10),
    db.select({ timestamp: clicks.timestamp, city: clicks.city, country: clicks.country, region: clicks.region, referrer: clicks.referrer })
      .from(clicks).where(eq(clicks.code, code)).orderBy(desc(clicks.timestamp)).limit(10),
  ]);
  res.json({
    total: total?.count ?? 0,
    days,
    locations: locations.map(({ count: n, ...place }) => ({ _id: place, count: n })),
    recent,
  });
});

app.use((error: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  if (error.status === 400 || error.status === 413) return res.status(error.status).json({ error: 'Invalid request body.' });
  console.error(error.message);
  return res.status(500).json({ error: 'The service could not complete your request.' });
});

export default app;
