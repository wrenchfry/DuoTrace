# DuoTrace

DuoTrace compares two Riot players, finds the matches they played together, and summarizes how well they perform as a duo. It supports patch and month filtering so you can check performance across a specific patch or time window.

## What it does

- compares two Riot IDs in the form `GameName#TAG`
- resolves accounts across supported Riot regions
- fetches shared match history
- filters results by patch and month
- calculates a summary of wins, losses, queue mix, and common patch history

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
$env:RIOT_API_KEY = "your_key_here"
dotnet restore
dotnet run --urls http://localhost:5000
```

Then open `http://localhost:5000` in the browser.

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
- shared match history depends on the data returned by Riot for the selected players
- the app is intentionally scoped to a focused duo-analysis workflow rather than a broader analytics platform
