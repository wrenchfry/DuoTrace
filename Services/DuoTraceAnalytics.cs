using System.Globalization;
using System.Text.RegularExpressions;
using DuoTraceApp.Models;

namespace DuoTraceApp.Services;

public static partial class DuoTraceAnalytics
{
    public static string ExtractPatch(string? rawVersion)
    {
        if (string.IsNullOrWhiteSpace(rawVersion))
        {
            return "unknown";
        }

        var match = PatchRegex().Match(rawVersion);
        return match.Success ? match.Value : "unknown";
    }

    public static DuoTraceSummary BuildSummary(List<DuoTraceMatchItem> matches)
    {
        if (matches.Count == 0)
        {
            return new DuoTraceSummary();
        }

        var sameTeamMatches = matches.Where(match => match.SameTeam).ToList();
        var duoWins = sameTeamMatches.Count(match => match.FirstPlayer.Win);

        var queueCounts = sameTeamMatches
            .GroupBy(match => match.Queue)
            .OrderByDescending(group => group.Count())
            .FirstOrDefault();

        return new DuoTraceSummary
        {
            Games = matches.Count,
            SameTeamGames = sameTeamMatches.Count,
            DuoWinRate = sameTeamMatches.Count > 0 ? (double)duoWins / sameTeamMatches.Count : 0,
            BestQueue = queueCounts is null ? "—" : queueCounts.Key,
        };
    }

    public static string FormatMonthKey(DateTime startedAt)
    {
        return startedAt.ToString("yyyy-MM", CultureInfo.InvariantCulture);
    }

    [GeneratedRegex(@"\d+\.\d+")]
    private static partial Regex PatchRegex();
}
