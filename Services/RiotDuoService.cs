using System.Globalization;
using System.Text.Json;
using DuoTraceApp.Models;

namespace DuoTraceApp.Services;

public interface IRiotDuoService
{
    Task<DuoTraceSearchResult> SearchAsync(DuoTraceSearchRequest request, CancellationToken cancellationToken = default);
    Task SearchProgressivelyAsync(
        DuoTraceSearchRequest request,
        Func<DuoTraceSearchResult, Task> onPreview,
        Action<string> onProgress,
        Action<DuoTraceSearchResult> onPartialResults,
        Action<DuoTraceSearchResult> onCompleted,
        CancellationToken cancellationToken = default);
}

public sealed class DuoTraceSearchResult
{
    public List<DuoTraceMatchItem> Matches { get; init; } = new();
    public DuoTraceSummary Summary { get; init; } = new();
}

public sealed class RiotApiException(System.Net.HttpStatusCode statusCode, string message) : Exception(message)
{
    public System.Net.HttpStatusCode StatusCode { get; } = statusCode;
}

public sealed class RiotDuoService : IRiotDuoService
{
    private const int BatchSize = 100;
    private const int PreviewSize = 20;
    private const int MaxConcurrentMatchRequests = 5;
    private static readonly string[] SupportedRegions = ["americas", "europe", "asia", "sea"];
    private static readonly Dictionary<int, string> QueueNames = new()
    {
        [400] = "Draft Pick",
        [420] = "Ranked Solo/Duo",
        [430] = "Blind Pick",
        [440] = "Ranked Flex",
        [450] = "ARAM",
        [480] = "Swiftplay",
        [700] = "Clash",
        [830] = "Intro Bots",
        [840] = "Beginner Bots",
        [850] = "Intermediate Bots",
        [900] = "URF",
        [1020] = "One for All",
        [1300] = "Nexus Blitz",
        [1400] = "Ultimate Spellbook",
        [1700] = "Arena",
        [1810] = "Swarm",
        [1820] = "Swarm",
        [1830] = "Swarm",
        [1840] = "Swarm",
        [1900] = "URF"
    };

    private readonly HttpClient _httpClient;
    private readonly ILogger<RiotDuoService> _logger;
    private readonly string _apiKey;

    public RiotDuoService(HttpClient httpClient, IConfiguration configuration, ILogger<RiotDuoService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
        _apiKey = new[]
            {
                Environment.GetEnvironmentVariable("RIOT_API_KEY"),
                configuration["RIOT_API_KEY"],
                configuration["RiotApi:ApiKey"]
            }
            .FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))
            ?? string.Empty;
    }

    public async Task<DuoTraceSearchResult> SearchAsync(DuoTraceSearchRequest request, CancellationToken cancellationToken = default)
    {
        DuoTraceSearchResult? result = null;
        await SearchProgressivelyAsync(request, _ => Task.CompletedTask, _ => { }, _ => { }, completed => result = completed, cancellationToken);
        return result ?? throw new InvalidOperationException("The Riot match search did not return a result.");
    }

    public async Task SearchProgressivelyAsync(
        DuoTraceSearchRequest request,
        Func<DuoTraceSearchResult, Task> onPreview,
        Action<string> onProgress,
        Action<DuoTraceSearchResult> onPartialResults,
        Action<DuoTraceSearchResult> onCompleted,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(_apiKey))
        {
            throw new InvalidOperationException("Missing Riot API key. Set the RIOT_API_KEY environment variable before searching.");
        }

        var first = ParseRiotId(request.FirstPlayer);
        var second = ParseRiotId(request.SecondPlayer);

        var (firstCandidates, secondCandidates) = await ResolveAccountPairsAsync(request.Region, first, second, cancellationToken);
        var candidatePairs = firstCandidates
            .SelectMany(firstCandidate => secondCandidates.Select(secondCandidate => new CandidatePair(firstCandidate, secondCandidate)))
            .ToList();
        var accounts = candidatePairs
            .SelectMany(pair => new[] { pair.First, pair.Second })
            .Distinct()
            .ToList();

        onProgress("Checking each player's most recent matches.");
        var recentHistoryTasks = accounts.ToDictionary(
            account => account,
            account => GetMatchIdsAsync(account.Region, account.AccountPuuid, 0, PreviewSize, cancellationToken));
        await Task.WhenAll(recentHistoryTasks.Values);

        var recentCandidates = GetSharedMatchCandidates(candidatePairs, recentHistoryTasks.ToDictionary(entry => entry.Key, entry => entry.Value.Result));
        var previewMatches = await FetchMatchItemsAsync(recentCandidates, onProgress, "Checking recent shared matches", null, cancellationToken);
        var preview = CreateResult(previewMatches);
        await onPreview(preview);

        var histories = recentHistoryTasks.ToDictionary(entry => entry.Key, entry => entry.Value.Result);
        var offsets = histories.ToDictionary(entry => entry.Key, entry => entry.Value.Count);
        var exhausted = histories.Where(entry => entry.Value.Count < PreviewSize).Select(entry => entry.Key).ToHashSet();
        var processedMatchIds = recentCandidates.Select(candidate => candidate.MatchId).ToHashSet(StringComparer.Ordinal);
        var allMatches = new System.Collections.Concurrent.ConcurrentDictionary<string, DuoTraceMatchItem>(
            preview.Matches.ToDictionary(match => match.MatchId, StringComparer.Ordinal),
            StringComparer.Ordinal);

        onProgress(preview.Matches.Count == 0
            ? "No shared games in the recent sample yet. Scanning older available match history."
            : $"Showing {preview.Matches.Count} recent shared {MatchWord(preview.Matches.Count)}. Scanning older available match history.");

        var pageNumber = 0;
        while (exhausted.Count < accounts.Count)
        {
            cancellationToken.ThrowIfCancellationRequested();
            pageNumber++;
            var nextPageTasks = accounts
                .Where(account => !exhausted.Contains(account))
                .ToDictionary(
                    account => account,
                    account => GetMatchIdsAsync(account.Region, account.AccountPuuid, offsets[account], BatchSize, cancellationToken));
            await Task.WhenAll(nextPageTasks.Values);

            foreach (var (account, pageTask) in nextPageTasks)
            {
                var page = pageTask.Result;
                histories[account].AddRange(page);
                offsets[account] += page.Count;
                if (page.Count < BatchSize)
                {
                    exhausted.Add(account);
                }
            }

            var candidates = GetSharedMatchCandidates(candidatePairs, histories)
                .Where(candidate => processedMatchIds.Add(candidate.MatchId))
                .ToList();
            onProgress(candidates.Count == 0
                ? $"Scanned history batch {pageNumber}; looking for older shared games."
                : $"Found {candidates.Count} more potential shared {MatchWord(candidates.Count)}. Checking match details.");

            await FetchMatchItemsAsync(
                candidates,
                onProgress,
                "Checking older shared matches",
                match =>
                {
                    allMatches.TryAdd(match.MatchId, match);
                    onPartialResults(CreateResult(allMatches.Values));
                },
                cancellationToken);
        }

        onCompleted(CreateResult(allMatches.Values));
    }

    private async Task<(List<ResolvedAccount> First, List<ResolvedAccount> Second)> ResolveAccountPairsAsync(
        string region,
        RiotAccountIdentifier first,
        RiotAccountIdentifier second,
        CancellationToken cancellationToken)
    {
        if (!string.Equals(region, "all", StringComparison.OrdinalIgnoreCase))
        {
            var accounts = await Task.WhenAll(
                ResolveAccountsForRegionAsync(region, first, cancellationToken),
                ResolveAccountsForRegionAsync(region, second, cancellationToken));
            return (accounts[0], accounts[1]);
        }

        var lookups = SupportedRegions.SelectMany(supportedRegion => new[]
        {
            ResolveAccountsForRegionAsync(supportedRegion, first, cancellationToken),
            ResolveAccountsForRegionAsync(supportedRegion, second, cancellationToken)
        });
        var results = await Task.WhenAll(lookups);

        return (
            results.Where((_, index) => index % 2 == 0).SelectMany(accounts => accounts).ToList(),
            results.Where((_, index) => index % 2 == 1).SelectMany(accounts => accounts).ToList());
    }

    private async Task<List<ResolvedAccount>> ResolveAccountsForRegionAsync(string region, RiotAccountIdentifier identifier, CancellationToken cancellationToken)
    {
        try
        {
            var account = await GetAccountAsync(region, identifier, cancellationToken);
            return new List<ResolvedAccount> { new(region, account.Puuid) };
        }
        catch (RiotApiException ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            _logger.LogDebug("Account lookup found no account in region {Region} for Riot ID {Identifier}", region, identifier.Value);
            return new List<ResolvedAccount>();
        }
    }

    private static List<MatchCandidate> GetSharedMatchCandidates(
        IEnumerable<CandidatePair> candidatePairs,
        IReadOnlyDictionary<ResolvedAccount, List<string>> histories)
    {
        return candidatePairs
            .SelectMany(pair =>
            {
                var secondIds = histories[pair.Second].ToHashSet(StringComparer.Ordinal);
                return histories[pair.First]
                    .Where(secondIds.Contains)
                    .Select(matchId => new MatchCandidate(matchId, pair.First.Region, pair.First.AccountPuuid, pair.Second.AccountPuuid));
            })
            .GroupBy(candidate => candidate.MatchId, StringComparer.Ordinal)
            .Select(group => group.First())
            .ToList();
    }

    private async Task<List<DuoTraceMatchItem>> FetchMatchItemsAsync(
        IReadOnlyCollection<MatchCandidate> candidates,
        Action<string> onProgress,
        string progressLabel,
        Action<DuoTraceMatchItem>? onMatchFound,
        CancellationToken cancellationToken)
    {
        if (candidates.Count == 0)
        {
            return new List<DuoTraceMatchItem>();
        }

        var results = new System.Collections.Concurrent.ConcurrentDictionary<string, DuoTraceMatchItem>(StringComparer.Ordinal);
        var completed = 0;
        await Parallel.ForEachAsync(
            candidates,
            new ParallelOptions { CancellationToken = cancellationToken, MaxDegreeOfParallelism = MaxConcurrentMatchRequests },
            async (candidate, token) =>
            {
                var match = await GetMatchAsync(candidate.Region, candidate.MatchId, token);
                if (match.Metadata.Participants.Contains(candidate.FirstPuuid) && match.Metadata.Participants.Contains(candidate.SecondPuuid))
                {
                    var item = BuildMatchItem(match, candidate.FirstPuuid, candidate.SecondPuuid);
                    if (item is not null)
                    {
                        results.TryAdd(item.MatchId, item);
                        onMatchFound?.Invoke(item);
                    }
                }

                var count = Interlocked.Increment(ref completed);
                if (count == candidates.Count || count % 10 == 0)
                {
                    onProgress($"{progressLabel}: {count} of {candidates.Count}.");
                }
            });

        return results.Values.ToList();
    }

    private async Task<List<string>> GetMatchIdsAsync(string region, string puuid, int start, int count, CancellationToken cancellationToken)
    {
        var url = $"{GetApiHost(region)}/lol/match/v5/matches/by-puuid/{Uri.EscapeDataString(puuid)}/ids?start={start}&count={count}";
        return await GetJsonAsync<List<string>>(url, cancellationToken);
    }

    private static DuoTraceSearchResult CreateResult(IEnumerable<DuoTraceMatchItem> matches)
    {
        var orderedMatches = SortMatches(matches);
        return new DuoTraceSearchResult
        {
            Matches = orderedMatches,
            Summary = DuoTraceAnalytics.BuildSummary(orderedMatches)
        };
    }

    private static string MatchWord(int count) => count == 1 ? "match" : "matches";

    private async Task<RiotAccountResponse> GetAccountAsync(string region, RiotAccountIdentifier identifier, CancellationToken cancellationToken)
    {
        var url = $"{GetApiHost(region)}/riot/account/v1/accounts/by-riot-id/{Uri.EscapeDataString(identifier.GameName)}/{Uri.EscapeDataString(identifier.TagLine)}";
        return await GetJsonAsync<RiotAccountResponse>(url, cancellationToken);
    }

    private async Task<RiotMatchResponse> GetMatchAsync(string region, string matchId, CancellationToken cancellationToken)
    {
        var url = $"{GetApiHost(region)}/lol/match/v5/matches/{Uri.EscapeDataString(matchId)}";
        return await GetJsonAsync<RiotMatchResponse>(url, cancellationToken);
    }

    private async Task<T> GetJsonAsync<T>(string url, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Add("X-Riot-Token", _apiKey);

        var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (response.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
        {
            var retryAfter = GetRetryAfterSeconds(response);
            _logger.LogWarning("Riot API rate-limited. Retrying in {Seconds} seconds.", retryAfter);
            await Task.Delay(TimeSpan.FromSeconds(retryAfter), cancellationToken);
            return await GetJsonAsync<T>(url, cancellationToken);
        }

        if (response.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden)
        {
            throw new RiotApiException(response.StatusCode,
                $"Riot API rejected the configured key ({(int)response.StatusCode}). Verify that RIOT_API_KEY is current and available to the running app.");
        }

        if (!response.IsSuccessStatusCode)
        {
            var message = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new RiotApiException(response.StatusCode, $"Riot API request failed ({response.StatusCode}): {message}");
        }

        var payload = await response.Content.ReadAsStringAsync(cancellationToken);
        return JsonSerializer.Deserialize<T>(payload, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        }) ?? throw new InvalidOperationException("Unable to deserialize Riot API response.");
    }

    private static int GetRetryAfterSeconds(HttpResponseMessage response)
    {
        if (response.Headers.TryGetValues("Retry-After", out var values) && int.TryParse(values.FirstOrDefault(), out var retryAfter))
        {
            return retryAfter;
        }

        return 120;
    }

    private static string GetApiHost(string region)
    {
        if (string.IsNullOrWhiteSpace(region) || !SupportedRegions.Contains(region, StringComparer.OrdinalIgnoreCase))
        {
            throw new ArgumentException("Unsupported Riot region.", nameof(region));
        }

        return $"https://{region}.api.riotgames.com";
    }

    private static RiotAccountIdentifier ParseRiotId(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new InvalidOperationException("Use Riot ID format GameName#TAG for both players.");
        }

        var parts = value.Split('#', 2, StringSplitOptions.TrimEntries);
        if (parts.Length != 2 || string.IsNullOrWhiteSpace(parts[0]) || string.IsNullOrWhiteSpace(parts[1]))
        {
            throw new InvalidOperationException("Use Riot ID format GameName#TAG for both players.");
        }

        return new RiotAccountIdentifier(parts[0], parts[1]);
    }

    private static List<DuoTraceMatchItem> SortMatches(IEnumerable<DuoTraceMatchItem> matches)
    {
        return matches
            .OrderByDescending(match => match.StartedAt)
            .ThenByDescending(match => match.QueueId)
            .ToList();
    }

    private static DuoTraceMatchItem? BuildMatchItem(RiotMatchResponse match, string firstPuuid, string secondPuuid)
    {
        var first = match.Info.Participants.FirstOrDefault(participant => participant.Puuid == firstPuuid);
        var second = match.Info.Participants.FirstOrDefault(participant => participant.Puuid == secondPuuid);

        if (first is null || second is null)
        {
            return null;
        }

        var startedAt = DateTimeOffset.FromUnixTimeMilliseconds(match.Info.GameCreation).UtcDateTime;
        var monthKey = DuoTraceAnalytics.FormatMonthKey(startedAt);
        var patch = DuoTraceAnalytics.ExtractPatch(match.Info.GameVersion);

        return new DuoTraceMatchItem
        {
            MatchId = match.Metadata.MatchId,
            QueueId = match.Info.QueueId,
            Queue = QueueNames.TryGetValue(match.Info.QueueId, out var queueName) ? queueName : $"Queue {match.Info.QueueId}",
            Patch = patch,
            MonthKey = monthKey,
            StartedAt = startedAt,
            Duration = FormatDuration(match.Info.GameDuration),
            GameMode = match.Info.GameMode,
            SameTeam = first.TeamId == second.TeamId,
            FirstPlayer = new DuoTraceParticipant
            {
                Name = !string.IsNullOrWhiteSpace(first.RiotIdGameName) ? $"{first.RiotIdGameName}#{first.RiotIdTagline}" : first.SummonerName,
                Champion = first.ChampionName,
                TeamId = first.TeamId,
                Win = first.Win,
                Kda = $"{first.Kills}/{first.Deaths}/{first.Assists}"
            },
            SecondPlayer = new DuoTraceParticipant
            {
                Name = !string.IsNullOrWhiteSpace(second.RiotIdGameName) ? $"{second.RiotIdGameName}#{second.RiotIdTagline}" : second.SummonerName,
                Champion = second.ChampionName,
                TeamId = second.TeamId,
                Win = second.Win,
                Kda = $"{second.Kills}/{second.Deaths}/{second.Assists}"
            }
        };
    }

    private static string FormatDuration(int seconds)
    {
        var minutes = Math.DivRem(seconds, 60, out var remainder);
        return $"{minutes}:{remainder:D2}";
    }

    private sealed record ResolvedAccount(string Region, string AccountPuuid);
    private sealed record CandidatePair(ResolvedAccount First, ResolvedAccount Second);
    private sealed record MatchCandidate(string MatchId, string Region, string FirstPuuid, string SecondPuuid);

    private sealed record RiotAccountIdentifier(string GameName, string TagLine)
    {
        public string Value => $"{GameName}#{TagLine}";
    }

    private sealed class RiotAccountResponse
    {
        public string Puuid { get; set; } = string.Empty;
    }

    private sealed class RiotMatchResponse
    {
        public RiotMatchMetadata Metadata { get; set; } = new();
        public RiotMatchInfo Info { get; set; } = new();
    }

    private sealed class RiotMatchMetadata
    {
        public string MatchId { get; set; } = string.Empty;
        public List<string> Participants { get; set; } = new();
    }

    private sealed class RiotMatchInfo
    {
        public long GameCreation { get; set; }
        public int GameDuration { get; set; }
        public string GameMode { get; set; } = string.Empty;
        public int QueueId { get; set; }
        public string GameVersion { get; set; } = string.Empty;
        public List<RiotParticipant> Participants { get; set; } = new();
    }

    private sealed class RiotParticipant
    {
        public string Puuid { get; set; } = string.Empty;
        public string RiotIdGameName { get; set; } = string.Empty;
        public string RiotIdTagline { get; set; } = string.Empty;
        public string SummonerName { get; set; } = string.Empty;
        public string ChampionName { get; set; } = string.Empty;
        public int TeamId { get; set; }
        public bool Win { get; set; }
        public int Kills { get; set; }
        public int Deaths { get; set; }
        public int Assists { get; set; }
    }
}
