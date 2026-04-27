# Vercel + GitHub Deployment Strategy

## Problem Statement
How might we maintain a clean deployment pipeline that supports daily commits (for GitHub contribution stats), explicit production releases, a stable staging environment, and a working local dev setup — while also enabling the OAuth Edge Function needed for Google Drive sync?

## Recommended Direction

**Trunk-based development with tagged production releases.**

Single long-lived branch (`main`). Production deploys triggered by Git tags via GitHub Actions, not by branch pushes. Vercel's native Git integration handles staging automatically.

```
daily commits → main → Vercel preview (staging, automatic)
release day   → git tag v1.2.3 → GitHub Action → vercel --prod
```

### Why tags over a release branch
- No extra branch to maintain or keep in sync
- Tags create a clean, visible release history on GitHub's Releases page
- Semantic versioning is explicit and auditable
- Modern standard (vs. GitFlow's `release` branch, which is legacy)

## Environment Map

| Environment | URL | Trigger | Purpose |
|---|---|---|---|
| Local dev | `http://localhost:3000` | `vercel dev` | Day-to-day development |
| Staging | `https://zenit-week-git-main-kruxik.vercel.app` | Push to `main` | QA, OAuth testing |
| Production | `https://zenitweek.com` | `git tag vX.Y.Z` | Live users |

## Components to Implement

### 1. Vercel configuration
- Disable automatic production deployments from `main` (set production branch to one that won't receive pushes, or disable Git → Production in Vercel dashboard)
- `main` branch remains a preview deployment → stable staging URL

### 2. GitHub Action — production deploy on tag
```yaml
# .github/workflows/deploy-production.yml
on:
  push:
    tags:
      - 'v*'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx vercel --prod --token ${{ secrets.VERCEL_TOKEN }}
        env:
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
```

Required GitHub secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

### 3. Vercel Edge Function — OAuth token exchange
Thin serverless function at `/api/token` that holds `GOOGLE_CLIENT_SECRET` as a Vercel environment variable. Receives `{ code, code_verifier, redirect_uri }` from the browser, exchanges with Google, returns `{ access_token, refresh_token }`.

The `client_secret` never appears in source code. Local developers who need Drive sync run `vercel dev` (which loads env vars from `.env.local`) or create their own Google OAuth client.

```
api/
  token.js   ← Edge Function (~20 lines)
```

### 4. Google Cloud Console — redirect URIs
Register all three environments:
```
http://localhost:3000/app
https://zenit-week-git-main-kruxik.vercel.app/app
https://zenitweek.com/app
```

### 5. Local development
Use `vercel dev` instead of opening the HTML file directly. This simulates the Edge Function locally, loading secrets from `.env.local` (gitignored).

```sh
# .env.local (gitignored)
GOOGLE_CLIENT_SECRET=your_secret_here
```

For non-auth work (layout, data logic, rendering) the HTML file can still be opened directly — only Drive sync testing requires `vercel dev`.

## Release workflow (day-to-day)

```sh
# Normal work — daily
git commit -m "feat: ..."
git push origin main          # → staging auto-deploys, GitHub stats update

# Releasing to production
git tag v1.2.3
git push origin v1.2.3        # → GitHub Action fires → vercel --prod
```

Optionally pair with a GitHub Release for changelog visibility:
```sh
gh release create v1.2.3 --generate-notes
```

## Key Assumptions

- **Staging URL is stable** — Vercel's branch preview URL (`*-git-main-*.vercel.app`) stays constant as long as the branch name doesn't change. Safe to register as a permanent redirect URI.
- **Free Vercel plan is sufficient** — Preview deployments, Edge Functions, and CLI deploys all work on the Hobby plan. GitHub Actions is free for public repos.
- **Contributors create their own OAuth client** — Open-source contributors who need Drive sync locally register their own Google OAuth app (standard practice). The `client_secret` is never in the repo.
- **`vercel dev` faithfully simulates production** — Edge Function behavior locally matches production closely enough for OAuth testing.

## Not Doing (and Why)

- **Release branch** — extra branch to maintain, no semantic versioning, GitFlow legacy
- **Deploy on every push to main** — would push unfinished work to production daily
- **client_secret in source code** — rejected; app will have many users, phishing risk is real
- **Separate staging Vercel project** — unnecessary complexity; branch preview URL is sufficient
