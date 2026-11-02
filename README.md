# DuoTrace

DuoTrace is a small ASP.NET Core app built to answer one practical question: how well do two Riot players actually perform together over time? It compares two Riot IDs, finds the games they shared, filters by patch and month, and summarizes duo performance in a clear way.

## Why this project exists

This project is focused on a single use case and keeps the scope realistic:

- compare two Riot IDs
- find shared games and match history
- filter by patch, month, and region
- surface a simple duo summary without overbuilding the app

That keeps the project easy to understand, easier to maintain, and more credible as a portfolio piece.

## Architecture

The app is intentionally simple and layered:

- ASP.NET MVC front end for the form and results page
- `RiotDuoService` for Riot API calls and match normalization
- `DuoTraceAnalytics` for patch parsing, filtering, and summary logic
- domain models for search requests, match data, and summary output

## Design tradeoffs

### Kept intentionally small

- one core problem: duo match analysis
- one external API: Riot
- one backend service and one UI layer
- local configuration and lightweight hosting

### Not included yet

- a database for early-stage use
- a broader analytics platform
- paid infrastructure
- speculative features unrelated to the main workflow

This is a deliberate choice to keep the app clear, useful, and easy to explain in a technical interview.

## Free-tier setup

This project is designed to run locally with a free Riot developer key and no paid infrastructure.

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

Open `http://localhost:5000` in a browser.

### Run tests

```powershell
dotnet test
```

### CI

The repo includes a GitHub Actions workflow at `.github/workflows/ci.yml` that restores, builds, and tests the app.

## Deploy-ready notes

The project includes:

- `Dockerfile`
- `appsettings.Production.json`
- a GitHub Actions workflow

This is not a full production stack, but it is ready for a simple free-tier deployment pattern or a container host.

## Risks and limitations

- Riot APIs still limit the amount of match history available
- older games can disappear from the API response
- large scans can take time because of rate limits

## Recommended next step

If you want to keep building from a portfolio angle, the next improvement is to add a cleaner results view or a small saved-history feature, rather than expanding the project into a large analytics suite.
