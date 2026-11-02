using System.Globalization;
using System.Text.Json;
using DuoTraceApp.Models;

namespace DuoTraceApp.Services;

public interface IRiotDuoService
{
    Task<DuoTraceSearchResult> SearchAsync(DuoTraceSearchRequest request, CancellationToken cancellationToken = default);
}

public sealed class DuoTraceSearchResult
{
    public List<DuoTraceMatchItem> Matches { get; init; } = new();
    public DuoTraceSummary Summary { get; init; } = new();
}

public sealed class RiotDuoService : IRiotDuoService
{
    private const int BatchSize = 100;
    private const int RequestDelayMs = 1200;
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
        _apiKey = configuration["RIOT_API_KEY"] ?? configuration["RiotApi:ApiKey"] ?? Environment.GetEnvironmentVariable("RIOT_API_KEY")
            ?? throw new InvalidOperationException("Missing Riot API key. Set the RIOT_API_KEY environment variable or dotnet user-secrets.");
    }

    public async Task<DuoTraceSearchResult> SearchAsync(DuoTraceSearchRequest request, CancellationToken cancellationToken = default)
    {
        var first = ParseRiotId(request.FirstPlayer);
        var second = ParseRiotId(request.SecondPlayer);

        var firstCandidates = request.Region == "all"
            ? await ResolveAccountsAcrossRegionsAsync(first, cancellationToken)
            : await ResolveAccountsForRegionAsync(request.Region, first, cancellationToken);

        var secondCandidates = request.Region == "all"
            ? await ResolveAccountsAcrossRegionsAsync(second, cancellationToken)
            : await ResolveAccountsForRegionAsync(request.Region, second, cancellationToken);

        var matchMap = new Dictionary<string, DuoTraceMatchItem>();
        foreach (var firstCandidate in firstCandidates)
        {
            foreach (var secondCandidate in secondCandidates)
            {
                var sharedMatches = await FindSharedMatchesForPlayersAsync(firstCandidate.Region, secondCandidate.Region, firstCandidate.AccountPuuid, secondCandidate.AccountPuuid, cancellationToken);
                foreach (var match in sharedMatches)
                {
                    matchMap[match.MatchId] = match;
                }
            }
        }

        var matches = SortMatches(matchMap.Values)
            .Where(match => DuoTraceAnalytics.MatchesPatchAndMonthFilter(match, request.Patch, request.Month))
            .ToList();

        return new DuoTraceSearchResult
        {
            Matches = matches,
            Summary = DuoTraceAnalytics.BuildSummary(matches)
        };
    }

    private async Task<List<ResolvedAccount>> ResolveAccountsAcrossRegionsAsync(RiotAccountIdentifier identifier, CancellationToken cancellationToken)
    {
        var candidates = new List<ResolvedAccount>();

        foreach (var region in SupportedRegions)
        {
            try
            {
                var account = await GetAccountAsync(region, identifier, cancellationToken);
                candidates.Add(new ResolvedAccount(region, account.Puuid));
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Account lookup failed for region {Region} and Riot ID {Identifier}", region, identifier.Value);
            }
        }

        return candidates;
    }

    private async Task<List<ResolvedAccount>> ResolveAccountsForRegionAsync(string region, RiotAccountIdentifier identifier, CancellationToken cancellationToken)
    {
        var account = await GetAccountAsync(region, identifier, cancellationToken);
        return new List<ResolvedAccount> { new(region, account.Puuid) };
    }

    private async Task<List<DuoTraceMatchItem>> FindSharedMatchesForPlayersAsync(string firstRegion, string secondRegion, string firstPuuid, string secondPuuid, CancellationToken cancellationToken)
    {
        var firstIds = await GetAvailableMatchIdsAsync(firstRegion, firstPuuid, cancellationToken);
        var secondIds = await GetAvailableMatchIdsAsync(secondRegion, secondPuuid, cancellationToken);
        var secondIdSet = new HashSet<string>(secondIds);
        var sharedIds = firstIds.Where(id => secondIdSet.Contains(id)).ToList();

        var results = new List<DuoTraceMatchItem>();
        foreach (var matchId in sharedIds)
        {
            var regionForMatch = firstRegion;
            if (!firstIds.Contains(matchId) && secondIds.Contains(matchId))
            {
                regionForMatch = secondRegion;
            }

            var match = await GetMatchAsync(regionForMatch, matchId, cancellationToken);
            if (match.Metadata.Participants.Contains(firstPuuid) && match.Metadata.Participants.Contains(secondPuuid))
            {
                var item = BuildMatchItem(match, firstPuuid, secondPuuid);
                if (item is not null)
                {
                    results.Add(item);
                }
            }
        }

        return results;
    }

    private async Task<List<string>> GetAvailableMatchIdsAsync(string region, string puuid, CancellationToken cancellationToken)
    {
        var ids = new List<string>();
        var start = 0;

        while (true)
        {
            var url = $"{GetApiHost(region)}/lol/match/v5/matches/by-puuid/{Uri.EscapeDataString(puuid)}/ids?start={start}&count={BatchSize}";
            var page = await GetJsonAsync<List<string>>(url, cancellationToken);
            if (page.Count == 0)
            {
                break;
            }

            ids.AddRange(page);
            if (page.Count < BatchSize)
            {
                break;
            }

            start += BatchSize;
        }

        return ids;
    }

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

        if (!response.IsSuccessStatusCode)
        {
            var message = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException($"Riot API request failed ({response.StatusCode}): {message}");
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
