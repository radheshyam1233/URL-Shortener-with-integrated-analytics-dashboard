# URL Shortener with Integrated Analytics Dashboard

[**Live Demo**](https://url-shortener-with-integrated-analy.vercel.app/)

A URL shortener that helps businesses see **where their product links get clicks**. Create a shareable link for a product page or campaign, then use the dashboard to review click counts, trends, and approximate visitor locations.

## Why I built it

I built this project for businesses that want to make better decisions about where to promote their products. A total click count shows how much traffic a link received. A city and country breakdown shows **where that interest came from**, helping a team choose which locations to test on Google Ads, YouTube Ads, or Facebook Ads.

For example, a seller can share a short link to a new product and see whether it draws more clicks from Delhi, Mumbai, or Bengaluru. If Mumbai consistently shows strong engagement, the seller can run a small geo-targeted campaign there and compare conversion rate, cost per purchase, and sales before increasing the budget. Clicks measure engagement. Purchases and revenue are measured separately in the store or ad platform.

## Try it

1. Open the [live dashboard](https://url-shortener-with-integrated-analy.vercel.app/) and paste a product or landing-page URL. A custom alias is optional.
2. Click **Shorten URL** and open the generated link in another tab.
3. In the browser that created the link, select **Refresh** and look under **Analytics** and **Recent visits**. The click count updates after the visit. City and country appear when the network location can be estimated.

For campaign comparisons, create one short link per channel and label each with a recognizable alias. Use the analytics filter to compare their traffic.

## Features

- Short URLs with automatic codes or custom aliases and HTTP 302 redirects.
- Total clicks, a seven-day activity chart, approximate location breakdown, and recent visits with time and referrer when available.
- Per-link analytics and sorting by creation time, click count, or alias.
- Request rate limiting and optional Redis caching for destination lookups.

## Tech stack and deployment

| Layer | Technology |
| --- | --- |
| Frontend | React and Vite, deployed on Vercel |
| Backend | Node.js 22 and Express, deployed on Render |
| Database | MongoDB Atlas for links and visit events |
| Geolocation | IP-based city and country estimates, with optional browser-approved approximate coordinates |
| Cache | Optional Redis cache with a MongoDB fallback |

The dashboard uses a per-link analytics token stored in the browser that created the link. Short links can be shared publicly. IP-based location is approximate and may be unavailable or inaccurate when visitors use a VPN or proxy.

## Run locally

1. Install Node.js 22 or newer and provide a MongoDB connection string.
2. Run `npm ci` and copy `.env.example` to `.env`. On Windows PowerShell, run `Copy-Item .env.example .env`.
3. Set `MONGODB_URI`, `FRONTEND_ORIGIN=http://localhost:5173`, `PUBLIC_API_URL=http://localhost:3000`, and `VITE_API_URL=http://localhost:3000`. Set `REDIS_URL` if you have Redis.
4. Run `npm start` for the API and `npm run dev` in a second terminal for the frontend. Open http://localhost:5173.

For a browser-local demo with sample data, leave `VITE_API_URL` unset and run the frontend. Use `npm run check` for the API syntax check and `npm run build` to verify the production frontend build.

## How it works

| Route | Behavior |
| --- | --- |
| `POST /api/links` | Validate a destination, reserve a unique code, and return a link and analytics token. |
| `GET /s/:code` | Resolve the destination, record the visit, and redirect with HTTP 302. |
| `POST /api/visit/:code` | Record a visit from the optional location-sharing page and return the destination. |
| `GET /api/analytics/:code` | Return the click count, seven-day series, top locations, and recent visits using the owner's bearer token. |
| `GET /api/health` | Report connectivity for MongoDB and Redis. |

## Deploy your own instance

- **Render:** Use `npm ci --omit=dev` as the build command and `npm start` as the start command. Set `MONGODB_URI`, `FRONTEND_ORIGIN` to your Vercel production origin, and `PUBLIC_API_URL` to your Render service origin. Use the exact HTTPS origins without a trailing slash. Add Render's outbound ranges to the Atlas IP access list and verify `/api/health` on the backend.
- **Vercel:** Import the repository as a Vite project. Set the public configuration variable `VITE_API_URL` to your Render service origin and redeploy so Vite includes it in the production build.
