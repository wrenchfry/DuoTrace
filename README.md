# DuoTrace

DuoTrace checks whether two League of Legends players have shared games.

Enter two Riot IDs, choose a routing region, and DuoTrace scans available Match V5 history from newest to oldest. Shared games show the match date, queue, champions, KDA, result, duration, match ID, and a League of Graphs match link.

## Use

1. Create a Riot development key at <https://developer.riotgames.com/>.
2. Open DuoTrace.
3. Add the key as the `RIOT_API_KEY` Cloudflare secret.
4. Enter both players as `GameName#TAG`.
5. Pick the routing region and run the search.

The key is used only by the Cloudflare Worker and is not committed to this repository or sent to the browser.

## Run Locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy to Cloudflare Workers

Use these Cloudflare build settings:

```text
Path: /
Build command: npm run build
Deploy command: npx wrangler deploy
```

Set the Riot key as a Worker secret before public use:

```bash
npx wrangler secret put RIOT_API_KEY
```
