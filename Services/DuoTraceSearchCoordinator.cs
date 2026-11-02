using System.Collections.Concurrent;
using DuoTraceApp.Models;
using Microsoft.Extensions.DependencyInjection;

namespace DuoTraceApp.Services;

public sealed record DuoTraceSearchJobStatus(
    string Id,
    string State,
    string Message,
    List<DuoTraceMatchItem> Matches,
    DuoTraceSummary Summary);

public sealed class DuoTraceSearchCoordinator(
    IServiceScopeFactory scopeFactory,
    IHostApplicationLifetime applicationLifetime,
    ILogger<DuoTraceSearchCoordinator> logger)
{
    private static readonly TimeSpan JobRetention = TimeSpan.FromHours(1);
    private readonly ConcurrentDictionary<string, SearchJob> _jobs = new();

    public async Task<DuoTraceSearchJobStatus> StartAsync(DuoTraceSearchRequest request)
    {
        RemoveExpiredJobs();
        var id = Guid.NewGuid().ToString("N");
        var job = new SearchJob(id);
        _jobs[id] = job;

        _ = Task.Run(() => RunAsync(job, request, applicationLifetime.ApplicationStopping));
        return await job.PreviewReady.Task;
    }

    public DuoTraceSearchJobStatus? GetStatus(string id)
    {
        return _jobs.TryGetValue(id, out var job) ? job.GetStatus() : null;
    }

    private async Task RunAsync(SearchJob job, DuoTraceSearchRequest request, CancellationToken cancellationToken)
    {
        try
        {
            using var scope = scopeFactory.CreateScope();
            var service = scope.ServiceProvider.GetRequiredService<IRiotDuoService>();
            await service.SearchProgressivelyAsync(
                request,
                preview =>
                {
                    job.Update("searching", "Recent matches loaded. Checking the rest of the available history.", preview);
                    job.PreviewReady.TrySetResult(job.GetStatus());
                    return Task.CompletedTask;
                },
                message => job.Update("searching", message),
                result => job.Update("searching", $"Loaded {result.Matches.Count} shared games so far. Checking older matches.", result),
                result =>
                {
                    var gameWord = result.Matches.Count == 1 ? "game" : "games";
                    var message = $"{result.Matches.Count} shared {gameWord} found in the available match history.";
                    job.Update("completed", message, result);
                },
                cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            job.Update("failed", "The search was stopped because DuoTrace is shutting down.");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "DuoTrace search {SearchId} failed", job.Id);
            job.Update("failed", ex.Message);
        }
        finally
        {
            job.PreviewReady.TrySetResult(job.GetStatus());
        }
    }

    private void RemoveExpiredJobs()
    {
        var expiration = DateTimeOffset.UtcNow - JobRetention;
        foreach (var (id, job) in _jobs)
        {
            if (job.CreatedAt < expiration && job.IsFinished && _jobs.TryRemove(id, out _))
            {
                logger.LogDebug("Removed expired DuoTrace search {SearchId}", id);
            }
        }
    }

    private sealed class SearchJob(string id)
    {
        private readonly object _sync = new();
        private DuoTraceSearchJobStatus _status = new(id, "searching", "Starting search.", new(), new());

        public string Id { get; } = id;
        public DateTimeOffset CreatedAt { get; } = DateTimeOffset.UtcNow;
        public TaskCompletionSource<DuoTraceSearchJobStatus> PreviewReady { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public bool IsFinished
        {
            get
            {
                lock (_sync)
                {
                    return _status.State is "completed" or "failed";
                }
            }
        }

        public void Update(string state, string message, DuoTraceSearchResult? result = null)
        {
            lock (_sync)
            {
                _status = new DuoTraceSearchJobStatus(
                    Id,
                    state,
                    message,
                    result?.Matches.ToList() ?? _status.Matches,
                    result?.Summary ?? _status.Summary);
            }
        }

        public DuoTraceSearchJobStatus GetStatus()
        {
            lock (_sync)
            {
                return _status with { Matches = _status.Matches.ToList() };
            }
        }
    }
}
