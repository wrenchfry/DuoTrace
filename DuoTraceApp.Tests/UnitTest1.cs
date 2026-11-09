using DuoTraceApp.Models;
using DuoTraceApp.Services;
using System.Net;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace DuoTraceApp.Tests;

public class DuoTraceAnalyticsTests
{
    [Fact]
    public void ExtractPatch_ReturnsMajorMinorVersion()
    {
        var patch = DuoTraceAnalytics.ExtractPatch("14.10.1");

        Assert.Equal("14.10", patch);
    }

    [Fact]
    public void BuildSummary_UsesOnlySameTeamGamesForDuoWinRate()
    {
        var matches = new List<DuoTraceMatchItem>
        {
            new() { SameTeam = true, Queue = "Ranked Solo/Duo", FirstPlayer = new DuoTraceParticipant { Win = true }, SecondPlayer = new DuoTraceParticipant { Win = true } },
            new() { SameTeam = true, Queue = "Ranked Solo/Duo", FirstPlayer = new DuoTraceParticipant { Win = false }, SecondPlayer = new DuoTraceParticipant { Win = false } },
            new() { SameTeam = false, Queue = "Ranked Flex", FirstPlayer = new DuoTraceParticipant { Win = false }, SecondPlayer = new DuoTraceParticipant { Win = true } }
        };

        var summary = DuoTraceAnalytics.BuildSummary(matches);

        Assert.Equal(3, summary.Games);
        Assert.Equal(2, summary.SameTeamGames);
        Assert.Equal(0.5d, summary.DuoWinRate);
        Assert.Equal("Ranked Solo/Duo", summary.BestQueue);
    }

    [Fact]
    public async Task SearchProgressivelyAsync_ReturnsRecentPreviewBeforeCompletingOlderHistory()
    {
        var handler = new RiotApiTestHandler();
        using var httpClient = new HttpClient(handler);
        using var loggerFactory = LoggerFactory.Create(builder => builder.SetMinimumLevel(LogLevel.None));
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["RIOT_API_KEY"] = "test-key" })
            .Build();
        var service = new RiotDuoService(httpClient, configuration, loggerFactory.CreateLogger<RiotDuoService>());
        DuoTraceSearchResult? preview = null;
        DuoTraceSearchResult? complete = null;
        var partialResultCounts = new List<int>();
        var requestCountAtPreview = 0;

        await service.SearchProgressivelyAsync(
            new DuoTraceSearchRequest
            {
                FirstPlayer = "First#NA1",
                SecondPlayer = "Second#NA1",
                Region = "americas"
            },
            result =>
            {
                preview = result;
                requestCountAtPreview = handler.RequestedUrls.Count;
                return Task.CompletedTask;
            },
            _ => { },
            result => partialResultCounts.Add(result.Matches.Count),
            result => complete = result);

        Assert.NotNull(preview);
        Assert.Single(preview.Matches);
        Assert.NotNull(complete);
        Assert.Equal(2, complete.Matches.Count);
        Assert.DoesNotContain(handler.RequestedUrls.Take(requestCountAtPreview), url => url.Contains("start=20", StringComparison.Ordinal));
        Assert.Contains(handler.RequestedUrls, url => url.Contains("start=20", StringComparison.Ordinal));
        Assert.Contains(2, partialResultCounts);
    }

    private sealed class RiotApiTestHandler : HttpMessageHandler
    {
        public List<string> RequestedUrls { get; } = new();

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var url = request.RequestUri!.ToString();
            RequestedUrls.Add(url);

            if (url.Contains("/riot/account/v1/accounts/by-riot-id/First/NA1", StringComparison.Ordinal))
            {
                return JsonResponse("""{"puuid":"first-puuid"}""");
            }

            if (url.Contains("/riot/account/v1/accounts/by-riot-id/Second/NA1", StringComparison.Ordinal))
            {
                return JsonResponse("""{"puuid":"second-puuid"}""");
            }

            if (url.Contains("/by-puuid/first-puuid/ids?start=0", StringComparison.Ordinal))
            {
                var ids = new[] { "NA1_1" }.Concat(Enumerable.Range(1, 19).Select(index => $"NA1_FIRST_{index}"));
                return JsonResponse(System.Text.Json.JsonSerializer.Serialize(ids));
            }

            if (url.Contains("/by-puuid/second-puuid/ids?start=0", StringComparison.Ordinal))
            {
                var ids = new[] { "NA1_1" }.Concat(Enumerable.Range(1, 19).Select(index => $"NA1_SECOND_{index}"));
                return JsonResponse(System.Text.Json.JsonSerializer.Serialize(ids));
            }

            if (url.Contains("/by-puuid/first-puuid/ids?start=20", StringComparison.Ordinal))
            {
                return JsonResponse("""["NA1_3"]""");
            }

            if (url.Contains("/by-puuid/second-puuid/ids?start=20", StringComparison.Ordinal))
            {
                return JsonResponse("""["NA1_3"]""");
            }

            if (url.EndsWith("/matches/NA1_1", StringComparison.Ordinal))
            {
                return JsonResponse(MatchPayload("NA1_1", "first-puuid", "second-puuid"));
            }

            if (url.EndsWith("/matches/NA1_3", StringComparison.Ordinal))
            {
                return JsonResponse(MatchPayload("NA1_3", "first-puuid", "second-puuid"));
            }

            throw new InvalidOperationException($"Unexpected Riot API request: {url}");
        }

        private static Task<HttpResponseMessage> JsonResponse(string json)
        {
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            });
        }

        private static string MatchPayload(string matchId, string firstPuuid, string secondPuuid)
        {
            return $$"""
                {
                  "metadata": { "matchId": "{{matchId}}", "participants": ["{{firstPuuid}}", "{{secondPuuid}}"] },
                  "info": {
                    "gameCreation": 1760000000000,
                    "gameDuration": 1800,
                    "gameMode": "CLASSIC",
                    "queueId": 420,
                    "gameVersion": "16.1.1",
                    "participants": [
                      { "puuid": "{{firstPuuid}}", "riotIdGameName": "First", "riotIdTagline": "NA1", "championName": "Ahri", "teamId": 100, "win": true, "kills": 5, "deaths": 2, "assists": 8 },
                      { "puuid": "{{secondPuuid}}", "riotIdGameName": "Second", "riotIdTagline": "NA1", "championName": "Lux", "teamId": 100, "win": true, "kills": 4, "deaths": 3, "assists": 9 }
                    ]
                  }
                }
                """;
        }
    }
}
