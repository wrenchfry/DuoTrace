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

    public static bool MatchesPatchAndMonthFilter(DuoTraceMatchItem match, string? patch, string? month)
    {
        var normalizedPatch = patch?.Trim();
        var normalizedMonth = month?.Trim();

        if (!string.IsNullOrWhiteSpace(normalizedPatch)
            && !string.Equals(match.Patch, normalizedPatch, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (!string.IsNullOrWhiteSpace(normalizedMonth)
            && !string.Equals(match.MonthKey, normalizedMonth, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return true;
    }

    public static DuoTraceSummary BuildSummary(List<DuoTraceMatchItem> matches)
    {
        if (matches.Count == 0)
        {
            return new DuoTraceSummary();
        }

        var sameTeamMatches = matches.Where(match => match.SameTeam).ToList();
        var duoWins = matches.Count(match => match.FirstPlayer.Win || match.SecondPlayer.Win);
        var sameTeamWins = sameTeamMatches.Count(match => match.FirstPlayer.Win || match.SecondPlayer.Win);

        var queueCounts = matches
            .GroupBy(match => match.Queue)
            .OrderByDescending(group => group.Count())
            .FirstOrDefault();

        var pairCounts = matches
            .GroupBy(match => $"{match.FirstPlayer.Champion} + {match.SecondPlayer.Champion}")
            .OrderByDescending(group => group.Count())
            .FirstOrDefault();

        var patchCounts = matches
            .GroupBy(match => match.Patch)
            .OrderByDescending(group => group.Count())
            .FirstOrDefault();

        return new DuoTraceSummary
        {
            Games = matches.Count,
            DuoWinRate = (double)duoWins / matches.Count,
            BestQueue = queueCounts is null ? "—" : queueCounts.Key,
            SameTeamWinRate = sameTeamMatches.Count > 0 ? (double)sameTeamWins / sameTeamMatches.Count : 0,
            TopPatch = patchCounts is null ? "—" : patchCounts.Key,
            TopDuoPair = pairCounts is null ? "—" : pairCounts.Key
        };
    }

    public static string FormatMonthKey(DateTime startedAt)
    {
        return startedAt.ToString("yyyy-MM", CultureInfo.InvariantCulture);
    }

    [GeneratedRegex(@"\d+\.\d+")]
    private static partial Regex PatchRegex();
}
