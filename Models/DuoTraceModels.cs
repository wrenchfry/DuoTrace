namespace DuoTraceApp.Models;

public class DuoTraceSearchRequest
{
    public string FirstPlayer { get; set; } = string.Empty;
    public string SecondPlayer { get; set; } = string.Empty;
    public string Region { get; set; } = "all";
}

public class DuoTraceMatchItem
{
    public string MatchId { get; set; } = string.Empty;
    public int QueueId { get; set; }
    public string Queue { get; set; } = string.Empty;
    public string Patch { get; set; } = "unknown";
    public string MonthKey { get; set; } = string.Empty;
    public DateTime StartedAt { get; set; }
    public string Duration { get; set; } = string.Empty;
    public string GameMode { get; set; } = string.Empty;
    public bool SameTeam { get; set; }
    public DuoTraceParticipant FirstPlayer { get; set; } = new();
    public DuoTraceParticipant SecondPlayer { get; set; } = new();
    public string MatchUrl => GetMatchUrl();

    private string GetMatchUrl()
    {
        if (string.IsNullOrWhiteSpace(MatchId))
        {
            return string.Empty;
        }

        var parts = MatchId.Split('_');
        var platform = parts.FirstOrDefault();
        var numericId = parts.Length > 1 ? parts[1] : string.Empty;
        var regionSlug = string.IsNullOrWhiteSpace(platform) ? string.Empty : new string(platform.Where(char.IsLetter).ToArray()).ToLowerInvariant();

        if (string.IsNullOrWhiteSpace(regionSlug) || string.IsNullOrWhiteSpace(numericId))
        {
            return string.Empty;
        }

        return $"https://www.leagueofgraphs.com/match/{regionSlug}/{numericId}";
    }
}

public class DuoTraceParticipant
{
    public string Name { get; set; } = string.Empty;
    public string Champion { get; set; } = string.Empty;
    public int TeamId { get; set; }
    public bool Win { get; set; }
    public string Kda { get; set; } = "0/0/0";
}

public class DuoTraceSummary
{
    public int Games { get; set; }
    public int SameTeamGames { get; set; }
    public double DuoWinRate { get; set; }
    public string BestQueue { get; set; } = "—";
}

public class DuoTraceViewModel
{
    public DuoTraceSearchRequest Search { get; set; } = new();
    public List<DuoTraceMatchItem> Matches { get; set; } = new();
    public DuoTraceSummary? Summary { get; set; }
    public string? Message { get; set; }
    public bool HasResults => Matches.Count > 0;
}
