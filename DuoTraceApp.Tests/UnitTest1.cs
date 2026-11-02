using DuoTraceApp.Models;
using DuoTraceApp.Services;

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
    public void MatchesPatchAndMonthFilter_RejectsWrongPatchAndMonth()
    {
        var match = new DuoTraceMatchItem
        {
            Patch = "14.10",
            MonthKey = "2025-10",
            StartedAt = new DateTime(2025, 10, 15)
        };

        Assert.True(DuoTraceAnalytics.MatchesPatchAndMonthFilter(match, "14.10", "2025-10"));
        Assert.False(DuoTraceAnalytics.MatchesPatchAndMonthFilter(match, "14.11", "2025-10"));
        Assert.False(DuoTraceAnalytics.MatchesPatchAndMonthFilter(match, "14.10", "2025-11"));
    }

    [Fact]
    public void BuildSummary_UsesObservedWinsAndMostCommonPatch()
    {
        var matches = new List<DuoTraceMatchItem>
        {
            new() { Patch = "14.10", SameTeam = true, FirstPlayer = new DuoTraceParticipant { Win = true }, SecondPlayer = new DuoTraceParticipant { Win = true } },
            new() { Patch = "14.10", SameTeam = true, FirstPlayer = new DuoTraceParticipant { Win = false }, SecondPlayer = new DuoTraceParticipant { Win = true } },
            new() { Patch = "14.11", SameTeam = false, FirstPlayer = new DuoTraceParticipant { Win = false }, SecondPlayer = new DuoTraceParticipant { Win = false } }
        };

        var summary = DuoTraceAnalytics.BuildSummary(matches);

        Assert.Equal(3, summary.Games);
        Assert.Equal("14.10", summary.TopPatch);
        Assert.Equal(0.6667d, Math.Round(summary.DuoWinRate, 4));
    }
}
