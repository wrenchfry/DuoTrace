# DuoTrace

DuoTrace compares two Riot IDs, finds the matches they shared, and summarizes how often they played on the same team. Patch and month analysis belongs in the separate duo-insights experience, not the player comparison search.

## What it does

- compares two Riot IDs in the form `GameName#TAG`
- resolves accounts across supported Riot regions
- fetches shared match history
- supports Riot Match API routing clusters: Americas, Europe, Asia, and Southeast Asia
- summarizes shared matches, same-team games, same-team win rate, and most-played queue
- shows a recent-match preview while the full available match history is scanned in the background

## Project structure

- `Controllers/` handles the web form and result page
- `Services/` contains Riot API access and analytics logic
- `Models/` defines the request, match, and summary objects
- `Views/` contains the MVC UI
- `DuoTraceApp.Tests/` covers the analytics rules and summary behavior

## Local setup

### Prerequisites

- .NET 10 SDK
- Riot developer API key

### Run locally

```powershell
cd C:\Users\leseg\projects\DuoTraceApp
$env:RIOT_API_KEY = "your_current_riot_api_key"
dotnet restore
dotnet run --urls http://localhost:5000
```

Then open `http://localhost:5000` in the browser.
The environment variable takes precedence over application settings. Restart the app after setting or changing the key. Never commit API keys to application settings or source control.

### Run tests

```powershell
dotnet test
```

## CI and deployment

This repo includes:

- GitHub Actions workflow for restore, build, and test
- `Dockerfile` for container-based deployment
- `appsettings.Production.json` for production settings

## Notes

- Riot API responses can be limited by rate limits and historical data availability
- shared match history depends on the data returned by Riot for the selected players and routing cluster
- Riot API rate limits and the size of both match histories affect how long the final scan takes; recent shared matches appear first, with older matches added as they are checked
- the app is intentionally scoped to a focused duo-analysis workflow rather than a broader analytics platform
