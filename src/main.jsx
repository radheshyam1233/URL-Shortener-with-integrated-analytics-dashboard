import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowUpRight, BarChart3, Clipboard, Globe2, LayoutDashboard, Link2, MousePointer2, Plus, RefreshCw } from 'lucide-react';
import './style.css';

const api = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const storeKey = api ? 'linkmetric:links:' + api : 'linkmetric:demo:v1';
const sample = [
  { code: 'portfolio', url: 'https://example.com/portfolio', total: 764 },
  { code: 'launch-notes', url: 'https://example.com/launch-notes', total: 318 },
  { code: 'resource-kit', url: 'https://example.com/resource-kit', total: 202 },
];
const dates = Array.from({ length: 7 }, (_, i) => {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() - 6 + i);
  return day.toISOString().slice(0, 10);
});
const demoLinks = sample.map((link, i) => ({
  ...link, createdAt: dates[i], shortUrl: shareUrl(link.code),
  days: [0.07, 0.17, 0.11, 0.21, 0.12, 0.19, 0.13].map((fraction, index) => ({ _id: dates[index], count: Math.round(link.total * fraction) })),
  locations: [], recent: [],
}));

function shareUrl(code) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('visit', code);
  return url.href;
}

function readLinks() {
  try {
    return JSON.parse(localStorage.getItem(storeKey)) || (api ? [] : demoLinks);
  } catch {
    return api ? [] : demoLinks;
  }
}

function saveLinks(links) {
  localStorage.setItem(storeKey, JSON.stringify(links));
}

async function request(path, options) {
  const response = await fetch(api + path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'The request failed.');
  return body;
}

function json(body) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(({ coords }) => resolve({
      latitude: Math.round(coords.latitude),
      longitude: Math.round(coords.longitude),
    }), () => resolve({}), { timeout: 5000, maximumAge: 0 });
  });
}

function Visit({ code }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const demo = api ? null : readLinks().find((link) => link.code === code);

  const [city, setCity] = useState('');

  async function open(withLocation, shareCity = false) {
    setBusy(true);
    setError('');
    try {
      if (api && !withLocation && !shareCity) {
        location.assign(api + '/s/' + encodeURIComponent(code));
        return;
      }
      const coords = withLocation ? await getLocation() : {};
      if (api) {
        const result = await request('/api/visit/' + encodeURIComponent(code), json({ ...coords, city: shareCity ? city.trim() : undefined }));
        location.assign(result.url);
        return;
      }
      if (!demo) throw new Error('This demo link is available only in the browser where it was created.');
      const region = Number.isFinite(coords.latitude) ? coords.latitude + '°, ' + coords.longitude + '°' : null;
      const today = new Date().toISOString().slice(0, 10);
      const links = readLinks().map((link) => {
        if (link.code !== code) return link;
        const increment = (list, key) => list.some((row) => row._id === key)
          ? list.map((row) => row._id === key ? { ...row, count: row.count + 1 } : row)
          : [...list, { _id: key, count: 1 }];
        return { ...link, total: link.total + 1, days: increment(link.days, today),
          locations: region ? increment(link.locations, region) : link.locations,
          recent: [{ timestamp: new Date().toISOString(), region, referrer: 'Direct' }, ...link.recent].slice(0, 10) };
      });
      saveLinks(links);
      location.assign(demo.url);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return <main className="visit-page"><section className="panel visit-card">
    <span className="brand-icon"><Link2 size={21}/></span>
    <h1>Open short link</h1>
    <p>{api ? 'The link owner can see your approximate city and country inferred from your network. You can also choose to share rounded coordinates with browser permission.' : 'Choose whether to share your approximate location with the link owner. Your browser will ask for permission.'}</p>
    {api ? <label>Share your city (optional)<input value={city} onChange={(event) => setCity(event.target.value)} maxLength={80} autoComplete="address-level2" placeholder="e.g. Varanasi" /></label> : <p className="subtle">Browser-local demo</p>}
    {error && <p role="alert" className="error">{error}</p>}
    <button className="primary" disabled={busy} onClick={() => open(false)}>{busy ? 'Opening…' : 'Open without sharing'}</button>
    {api && <button className="secondary" disabled={busy || !city.trim()} onClick={() => open(false, true)}>Share city and open</button>}
    <button className="secondary" disabled={busy} onClick={() => open(true, true)}>Share approximate location</button>
  </section></main>;
}

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
function locationLabel(city, country, region) {
  return [city, country ? countryNames.of(country) : null].filter(Boolean).join(', ') || region || 'Unknown';
}

const number = new Intl.NumberFormat('en-US');
const dayLabel = (day) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

function Chart({ values }) {
  const max = Math.max(20, Math.ceil(Math.max(...values) / 40) * 40);
  return <div className="chart" role="img" aria-label={values.map((value, i) => dayLabel(dates[i]) + ': ' + value + ' clicks').join(', ')}>
    <div className="axis">{[1, .75, .5, .25, 0].map((value) => <span key={value}>{max * value}</span>)}</div>
    <div className="plot">
      <div className="bars">{values.map((value, i) => <div className="bar-slot" key={dates[i]}><div title={value + ' clicks'} className="bar" style={{ height: (value / max * 100) + '%' }}/></div>)}</div>
      <div className="days">{dates.map((day) => <span key={day}>{dayLabel(day)}</span>)}</div>
    </div>
  </div>;
}

function Dashboard() {
  const [links, setLinks] = useState(readLinks);
  const [stats, setStats] = useState({});
  const [sort, setSort] = useState('newest');
  const [selected, setSelected] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [url, setUrl] = useState('');
  const [alias, setAlias] = useState('');

  useEffect(() => {
    const reload = () => { setLinks(readLinks()); setRefresh((value) => value + 1); };
    window.addEventListener('focus', reload);
    window.addEventListener('storage', reload);
    return () => { window.removeEventListener('focus', reload); window.removeEventListener('storage', reload); };
  }, []);

  useEffect(() => {
    if (!api) return;
    let active = true;
    Promise.allSettled(links.map(async (link) => [link.code, await request('/api/analytics/' + link.code, {
      headers: { Authorization: 'Bearer ' + link.ownerToken },
    })])).then((results) => {
      if (!active) return;
      setStats((previous) => ({ ...previous, ...Object.fromEntries(results.filter((item) => item.status === 'fulfilled').map((item) => item.value)) }));
      setSyncError(results.some((item) => item.status === 'rejected') ? 'Some analytics could not be refreshed.' : '');
    });
    return () => { active = false; };
  }, [links, refresh]);

  const rows = links.map((link) => ({ ...link, ...stats[link.code] }));
  const sortedRows = [...rows].sort((a, b) => {
    if (sort === 'clicks') return (b.total || 0) - (a.total || 0) || b.createdAt.localeCompare(a.createdAt);
    if (sort === 'alias') return a.code.localeCompare(b.code);
    if (sort === 'oldest') return a.createdAt.localeCompare(b.createdAt);
    return b.createdAt.localeCompare(a.createdAt);
  });
  const visible = selected ? rows.filter((link) => link.code === selected) : rows;
  const clicks = visible.reduce((sum, link) => sum + (link.total || 0), 0);
  const values = dates.map((date) => visible.reduce((sum, link) => sum + (link.days?.find((day) => day._id === date)?.count || 0), 0));
  const regions = new Map();
  for (const link of visible) {
    for (const { _id, count } of link.locations || []) {
      const label = typeof _id === 'string' ? _id : locationLabel(_id.city, _id.country, _id.region);
      regions.set(label, (regions.get(label) || 0) + count);
    }
  }
  const recent = visible.flatMap((link) => (link.recent || []).map((visit) => ({ ...visit, code: link.code }))).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 10);

  async function create(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    setSaving(true);
    try {
      const destination = new URL(url.trim());
      if (!['http:', 'https:'].includes(destination.protocol) || destination.username || destination.password) throw new Error('Enter a valid HTTP or HTTPS URL.');
      const code = alias.trim() || crypto.randomUUID().slice(0, 8);
      if (!/^[\w-]{3,32}$/.test(code)) throw new Error('Use 3–32 letters, numbers, hyphens or underscores for the alias.');
      if (!api && links.some((link) => link.code === code)) throw new Error('That alias is already in use.');
      const link = api
        ? await request('/api/links', json({ url: destination.href, alias: alias.trim() }))
        : { code, url: destination.href, shortUrl: shareUrl(code), createdAt: new Date().toISOString(), total: 0, days: [], locations: [], recent: [] };
      const next = [link, ...readLinks()];
      saveLinks(next);
      setLinks(next);
      setUrl('');
      setAlias('');
      setNotice('Short link created.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice('Link copied.');
    } catch {
      setNotice('Copy this link: ' + value);
    }
  }

  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="#"><span className="brand-icon"><Link2 size={20}/></span>URL Shortener with Integrated Analytics Dashboard</a>
      <nav aria-label="Workspace"><a href="#overview" className="nav-active"><LayoutDashboard size={18}/> Overview</a><a href="#links"><Link2 size={18}/> My links</a><a href="#analytics"><BarChart3 size={18}/> Analytics</a></nav>
      <div className="sidebar-foot"><div className="avatar">URL</div><div><strong>My workspace</strong><small>{api ? 'Connected dashboard' : 'Browser-local demo'}</small></div></div>
    </aside>
    <main className="main" id="overview">
      <div className="top"><span>Workspace <span className="slash">/</span> Overview</span><button className="secondary refresh" onClick={() => { setLinks(readLinks()); setRefresh(refresh + 1); }}><RefreshCw size={15}/> Refresh</button></div>
      <header><h1>Link overview</h1><p>Create short links and see how people engage with them.</p></header>
      <section className="panel create">
        <div className="section-heading"><span className="tile violet"><Link2 size={19}/></span><div><h2>Create a short link</h2><p>{api ? 'Paste a URL. Your approximate city and country are inferred from your network.' : 'Paste a destination URL and optionally choose a custom alias.'}</p></div></div>
        <form onSubmit={create}><label>Destination URL<input type="url" required maxLength="2048" placeholder="https://example.com/your-long-url" value={url} onChange={(e) => setUrl(e.target.value)}/></label><label>Custom alias <span className="subtle">(optional)</span><input placeholder="my-link" maxLength="32" value={alias} onChange={(e) => setAlias(e.target.value)}/></label><button className="primary" disabled={saving}><Plus size={18}/>{saving ? 'Creating…' : 'Shorten URL'}</button></form>
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="notice" role="status">{notice}</p>}
      </section>
      <div className="analytics-head" id="analytics"><h2>Analytics</h2><label className="filter"><span>Show</span><select value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">All links</option>{rows.map((link) => <option key={link.code}>{link.code}</option>)}</select></label></div>
      {syncError && <p className="error" role="status">{syncError}</p>}
      <div className="metrics">
        {[[MousePointer2, 'violet', 'Total clicks', clicks], [Link2, 'blue', 'Links tracked', visible.length], [Globe2, 'green', 'Locations recorded', regions.size]].map(([Icon, color, title, value]) => <section className="panel metric" key={title}><span className={'tile ' + color}><Icon size={19}/></span><div><p>{title}</p><strong>{number.format(value)}</strong></div></section>)}
      </div>
      <div className="analysis-grid">
        <section className="panel chart-panel"><div className="section-heading spread"><div><h2>Click activity</h2><p>Visits by day over the last 7 days (UTC)</p></div><span className="chart-key">Clicks</span></div><Chart values={values}/></section>
        <section className="panel locations"><div className="section-heading"><span className="tile green"><Globe2 size={19}/></span><div><h2>Top locations</h2><p>Approximate visitor locations</p></div></div>
          {regions.size ? <ul>{[...regions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([region, count]) => <li key={region}><span>{region}</span><strong>{number.format(count)}</strong></li>)}</ul> : <div className="empty"><Globe2 size={25}/><strong>No locations yet</strong><p>{api ? "City and country appear when they can be estimated from the visitor’s network." : "Open a demo short link and choose to share your location."}</p></div>}
        </section>
      </div>
      <section className="panel table-panel" id="links"><div className="section-heading spread"><div><h2>My links</h2><p>Open or copy the links created in this browser.</p></div><label className="filter"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="clicks">Most clicks</option><option value="alias">Alias A–Z</option></select></label></div>
      {rows.length ? <div className="table-scroll"><table><thead><tr><th>Short link</th><th>Destination</th><th>Time created</th><th>Created from</th><th>Clicks</th><th>Actions</th></tr></thead><tbody>{sortedRows.map((link) => <tr key={link.code}><td><a className="code-link" href={link.shortUrl} target="_blank" rel="noreferrer"><Link2 size={16}/>{link.code}</a></td><td><a className="destination" href={link.url} target="_blank" rel="noreferrer" title={link.url}>{link.url}</a></td><td>{new Date(link.createdAt).toLocaleString()}</td><td>{locationLabel(link.createdCity, link.createdCountry)}</td><td>{number.format(link.total || 0)}</td><td><div className="actions"><button title="Copy short link" aria-label={'Copy short link ' + link.code} onClick={() => copy(link.shortUrl)}><Clipboard size={17}/></button>{api && <button aria-label={'Copy location opt-in link ' + link.code} title="Copy location opt-in link" onClick={() => copy(shareUrl(link.code))}><Globe2 size={17}/></button>}<a title="Open short link" aria-label={'Open short link ' + link.code} href={link.shortUrl} target="_blank" rel="noreferrer"><ArrowUpRight size={17}/></a></div></td></tr>)}</tbody></table></div> : <p className="table-empty">Your first short link will appear here.</p>}
      </section>
      <section className="panel table-panel"><div className="section-heading"><span className="tile violet"><Activity size={19}/></span><div><h2>Recent visits</h2><p>The latest visits for the selected links.</p></div></div>
      {recent.length ? <div className="table-scroll"><table><thead><tr><th>Link</th><th>Time</th><th>Referrer</th><th>City</th><th>Country</th><th>GPS grid</th></tr></thead><tbody>{recent.map((visit, i) => <tr key={visit.timestamp + i}><td>{visit.code}</td><td>{new Date(visit.timestamp).toLocaleString()}</td><td>{visit.referrer}</td><td>{visit.city || '—'}</td><td>{visit.country ? countryNames.of(visit.country) : '—'}</td><td>{visit.region || '—'}</td></tr>)}</tbody></table></div> : <p className="table-empty">New visits will appear here.</p>}
      </section>
    </main>
  </div>;
}

const code = new URLSearchParams(location.search).get('visit');
createRoot(document.getElementById('root')).render(code ? <Visit code={code}/> : <Dashboard/>);
