# URL Shortener with Integrated Analytics Dashboard

A React URL shortener and analytics dashboard backed by Node.js, Express, MongoDB, and Redis. Create a random short link or custom alias, then track clicks, daily activity, referrers, and approximate visitor locations. Sort links by creation time, click count, or alias.

## Run locally

1. Install Node.js 22 or newer. Start MongoDB and optionally Redis, or get connection URLs from managed providers.
2. Run `npm ci`. Copy `.env.example` to `.env` and fill in the connection URLs. On Windows PowerShell, use `Copy-Item .env.example .env`.
3. Run `npm start` for the Express API. In a second terminal run `npm run dev`, then open http://localhost:5173.
4. Create a link, open its short URL, and refresh the dashboard. To check geolocation, use the globe action to copy an opt-in link, open it, choose **Share approximate location**, and approve the browser prompt.

For a browser-local demo with sample data, leave `VITE_API_URL` unset and run the frontend. Demo links work in the browser profile where they were created. An API-backed link works for anyone who can reach the deployed service.

## Push to GitHub

Extract the ZIP and open a terminal in the folder containing `package.json`. Create an empty GitHub repository without a README. Replace the example remote with your new repository URL.

```sh
git init
git add .
git commit -m "Add URL Shortener with Integrated Analytics Dashboard"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/url-shortener-with-integrated-analytics-dashboard.git
git push -u origin main
```

The ZIP includes the lockfile, deployment configuration, and an environment template. Keep your credentials in the local `.env` file or your hosts' environment settings.

## Deploy the frontend and API

1. Import the GitHub repository in Netlify. The included `netlify.toml` builds the Vite app and publishes `dist`. Record the assigned HTTPS site URL.
2. On Render, create a Blueprint from the same repository to use `render.yaml`. Set `MONGODB_URI` and `REDIS_URL` to connection URLs accessible to Render. For the URL settings use `FRONTEND_ORIGIN=https://YOUR-SITE.netlify.app` and `PUBLIC_API_URL=https://YOUR-SERVICE.onrender.com`, with the actual assigned names and no trailing slashes. If Render assigns a different URL, update `PUBLIC_API_URL` to match and redeploy the API.
3. Open `https://YOUR-SERVICE.onrender.com/api/health`. Check that the database and cache report `connected`.
4. In Netlify, set `VITE_API_URL=https://YOUR-SERVICE.onrender.com` and trigger a new build. Vite reads this value at build time.
5. Open the deployed frontend, create and open a short link from a private browser window, and refresh the original dashboard to confirm the count changes.

[Netlify Vite deployment](https://docs.netlify.com/build/frameworks/framework-setup-guides/vite/) · [Render Blueprint reference](https://render.com/docs/blueprint-spec)

## How it works

| Route | Behavior |
| --- | --- |
| `POST /api/links` | Validate a destination, reserve a unique code, and return a link and analytics token. |
| `GET /s/:code` | Resolve the destination, record the visit, and redirect with HTTP 302. |
| `POST /api/visit/:code` | Record a visit from the optional location-sharing page and return the destination. |
| `GET /api/analytics/:code` | Return the click count, seven-day series, top locations, and recent visits using the owner's bearer token. |
| `GET /api/health` | Report connectivity for MongoDB and Redis. |

The dashboard stores each link's analytics token in the browser that created it. Clearing browser storage removes dashboard access to those links. The backend stores token hashes. The browser's Geolocation API requires a secure context and visitor permission. The frontend rounds coordinates to whole degrees before sending them. A visitor can continue without location, and permission denial still allows navigation. The backend automatically estimates city and country from the request IP using the bundled GeoIP database, both when creating a short link and when recording each visit. MongoDB stores the estimated city, country, and timestamps without storing raw IP addresses in the application records. VPNs, proxies, and private IP addresses can produce inaccurate or unknown locations. The dashboard displays click counts and the ten latest visits for the current selection. Rounded GPS coordinates are optional and shown separately. The browser-local demo does not perform automatic IP lookup.

Redis caches code-to-destination lookups for 15 minutes. MongoDB remains the source of truth. The API falls back to MongoDB when Redis is unavailable. Rate limits are 180 requests per minute overall and 15 link creations per minute per IP on a single API instance. The built-in limiter uses per-process counters.

## Verification

Run `npm run check` to check API syntax and `npm run build` to compile the frontend. For a deployment smoke test, create a link, open it, check that the dashboard increments, and try creating a duplicate alias to verify conflict handling.
