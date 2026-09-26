# DuoTrace

DuoTrace finds League of Legends matches two players have in common. Enter two Riot IDs and a Riot routing region; the app scans the match history Riot makes available, then shows every shared match it can verify.

For each shared game, DuoTrace displays the date, queue, game mode and duration, whether the players were teammates or opponents, each player's champion and KDA, the match ID, and a link to the match on League of Graphs.

## How it works

The browser app sends requests to a Cloudflare Worker. The Worker keeps the Riot API key private, looks up both accounts, reads their Match V5 history in batches, and caches match details for 30 days. The browser verifies that both players appear in each possible shared match before displaying it.

## Requirements

- Node.js 20 or later
- A Riot Games developer API key
- A Cloudflare account for deployment

## Run locally

Install dependencies:

```bash
npm install
```

Create a local Worker secrets file named `.dev.vars` with your Riot API key:

```text
RIOT_API_KEY=your_riot_developer_key
```

Then start the development server:

```bash
npm run dev
```

Open the URL Vite prints in the terminal. Use Riot IDs in the format `GameName#TAG` and choose the routing region that applies to the players: `americas`, `europe`, `asia`, or `sea`.

## Build and deploy

Create the production secret once before deploying:

```bash
npx wrangler secret put RIOT_API_KEY
```

Build and deploy the site and Worker:

```bash
npm run deploy
```

The Worker serves the built frontend from `dist/` and handles the `/api/account`, `/api/match-ids`, and `/api/match` routes.

## Limitations

Results are limited to the match history returned by Riot's API. Older games may no longer be available, and players with extensive histories may have only their most recent games exposed. Riot API rate limits can also make a long search take longer.

## Security

Keep `RIOT_API_KEY` in `.dev.vars` locally and in a Cloudflare Worker secret in production. Do not commit it to the repository; the `.dev.vars` file is already ignored by Git.
