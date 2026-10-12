# Analytics

Ex Situ uses self-hosted [Umami](https://umami.is) (v3) for page views and a few custom events.
It sets no cookies and stores no IP addresses or personal data. Sessions are a salted hash that
rotates, and the tracker honours Do Not Track. Nothing loads unless the env vars below are set, so
local development and forks send nothing.

Umami is commonly run without a consent banner for these reasons. Confirm that this holds for your
own setup.

## What is tracked

**Page views.** The query string and hash are stripped (`data-exclude-search`, `data-exclude-hash`).
The map rewrites `?lat=&lng=&zoom=` on every pan through `history.replaceState`, which Umami
hooks. Without stripping, every pan would count as a page view. `/map?place=Egypt` is therefore
recorded as `/map`. Which places people open is covered by the events instead.

**Custom events** (`lib/analytics.ts` → `track()`):

| Event | Fired when | Data |
|---|---|---|
| `arc_click` | An arc on the map is clicked (not when it's deselected) | `from`, `to`, `artifacts` |
| `territory_drilldown` | A territory is opened from the origins list, the command palette or a preview card | `territory` |
| `artifact_open` | An artifact is shown in the artifact view: on open and on each previous/next | `id`, `institution` |
| `outbound_institution_click` | **The visitor leaves for the institution's own record** (source button or image credit link) | `institution`, `host`, `id`, `via` (`button` / `credit`) |
| `share_click` | Copy link: the current view (object panel) or one artifact (artifact view) | `target` (`view` / `artifact`), `id` |
| `command_palette_search` | A result is picked in the command palette after typing (one event per pick, not per keystroke) | `query` (first 100 chars), `type` (`territory` / `site` / `institution` / `fly_to`), `pick` |

Values are capped at 100 characters, empty values are dropped, and `track()` is a no-op if the
script is missing or blocked.

Useful views in the Umami dashboard: **Events**, filtered on `outbound_institution_click` and
broken down by `institution`, shows how many visits Ex Situ sends to each institution. Compare
`artifact_open` with `outbound_institution_click` to see how often a viewed artifact leads to a
visit to its record.

## Frontend configuration

`frontend/.env` (build time, because `NEXT_PUBLIC_*` values are inlined by `next build`):

```bash
NEXT_PUBLIC_UMAMI_SRC=https://stats.example.org/script.js
NEXT_PUBLIC_UMAMI_WEBSITE_ID=00000000-0000-0000-0000-000000000000
NEXT_PUBLIC_UMAMI_DOMAINS=exsitu.app
```

- `NEXT_PUBLIC_UMAMI_SRC`: the tracker URL. Its origin is added to the CSP `script-src` and
  `connect-src` in `next.config.js` automatically.
- `NEXT_PUBLIC_UMAMI_WEBSITE_ID`: from Umami → Settings → Websites → Add website.
- `NEXT_PUBLIC_UMAMI_DOMAINS`: hostnames to count. Anything else (localhost, previews) is ignored.

Rebuild and restart the frontend after changing these.

## Running Umami on the server (Docker)

Umami runs in its own containers with its own Postgres, separate from the Strapi database. It needs
about 300–500 MB of RAM.

`docker-compose.yml` (in its own directory on the server, e.g. `/opt/umami/`, not in this repo):

```yaml
services:
  umami:
    image: ghcr.io/umami-software/umami:3.4.0
    ports:
      - "127.0.0.1:3001:3000"   # only reachable through the reverse proxy
    environment:
      DATABASE_URL: postgresql://umami:${UMAMI_DB_PASSWORD}@db:5432/umami
      APP_SECRET: ${UMAMI_APP_SECRET}
      # Optional: names that ad-block lists don't match
      # TRACKER_SCRIPT_NAME: insights.js
    depends_on:
      db:
        condition: service_healthy
    init: true
    restart: always
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:3000/api/heartbeat"]
      interval: 10s
      timeout: 5s
      retries: 5

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: umami
      POSTGRES_USER: umami
      POSTGRES_PASSWORD: ${UMAMI_DB_PASSWORD}
    volumes:
      - umami-db:/var/lib/postgresql/data
    restart: always
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U umami -d umami"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  umami-db:
```

`.env` next to it (never commit it):

```bash
UMAMI_DB_PASSWORD=<openssl rand -hex 24>
UMAMI_APP_SECRET=<openssl rand -hex 32>
```

Then:

```bash
docker compose up -d
docker compose logs -f umami     # wait for "Ready"
```

### Reverse proxy and TLS

Give Umami its own subdomain (DNS A record → the server) and proxy it to `127.0.0.1:3001`.
Example for nginx (with certbot for TLS):

```nginx
server {
    server_name stats.example.org;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
certbot --nginx -d stats.example.org
```

With Caddy, the whole block is `stats.example.org { reverse_proxy 127.0.0.1:3001 }`.

### First login

1. Open `https://stats.example.org` and log in with `admin` / `umami`. **Change that password
   immediately** (Settings → Profile).
2. Settings → Websites → Add website: name `Ex Situ`, domain `exsitu.app`. Copy the Website ID.
3. Set the three `NEXT_PUBLIC_UMAMI_*` variables in `frontend/.env`, rebuild and restart the frontend.
4. Check: open exsitu.app with the browser's network tab open. You should see `script.js` load and
   a `POST …/api/send` on navigation and on an arc click. The Umami realtime view should show the visit.

### Backups and updates

- Back up: `docker compose exec db pg_dump -U umami umami | gzip > umami-$(date +%F).sql.gz`
- Update: change the image tag, then `docker compose pull && docker compose up -d`. Read the
  release notes before major versions.

## Adding an event

Call `track("event_name", { ... })` from `@/lib/analytics` and add the name to the
`AnalyticsEvent` type and to the table above. Never send free text without a length cap, and never
send anything that identifies a person.
