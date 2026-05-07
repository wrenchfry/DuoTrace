# DuoTrace

DuoTrace checks whether two League of Legends players have shared games.

Enter your Riot API key, add two Riot IDs, choose a routing region, and DuoTrace scans available Match V5 history from newest to oldest. Shared games show the match date, queue, champions, KDA, result, duration, match ID, and a League of Graphs match link.

## Use

1. Create a Riot development key at <https://developer.riotgames.com/>.
2. Open DuoTrace.
3. Paste the key into the Riot API key field.
4. Enter both players as `GameName#TAG`.
5. Pick the routing region and run the search.

The key is used only in the browser request and is not committed to this repository.

## Run Locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The app is static and can be hosted on GitHub Pages.
