using System.Diagnostics;
using DuoTraceApp.Models;
using DuoTraceApp.Services;
using Microsoft.AspNetCore.Mvc;

namespace DuoTraceApp.Controllers;

public class HomeController : Controller
{
    private readonly IRiotDuoService _riotDuoService;
    private readonly DuoTraceSearchCoordinator _searchCoordinator;

    public HomeController(IRiotDuoService riotDuoService, DuoTraceSearchCoordinator searchCoordinator)
    {
        _riotDuoService = riotDuoService;
        _searchCoordinator = searchCoordinator;
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> StartSearch(DuoTraceViewModel model)
    {
        if (model.Search is null
            || string.IsNullOrWhiteSpace(model.Search.FirstPlayer)
            || string.IsNullOrWhiteSpace(model.Search.SecondPlayer))
        {
            return BadRequest(new { message = "Enter two Riot IDs in the format GameName#TAG." });
        }

        var status = await _searchCoordinator.StartAsync(model.Search);
        return Json(status);
    }

    [HttpGet]
    public IActionResult SearchStatus(string id)
    {
        var status = _searchCoordinator.GetStatus(id);
        return status is null ? NotFound() : Json(status);
    }

    [HttpGet]
    public IActionResult Index()
    {
        return View(new DuoTraceViewModel
        {
            Search = new DuoTraceSearchRequest { Region = "all" }
        });
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Index(DuoTraceViewModel model, CancellationToken cancellationToken)
    {
        if (model.Search is null)
        {
            model.Search = new DuoTraceSearchRequest { Region = "all" };
        }

        if (string.IsNullOrWhiteSpace(model.Search.FirstPlayer) || string.IsNullOrWhiteSpace(model.Search.SecondPlayer))
        {
            model.Message = "Enter two Riot IDs in the format GameName#TAG.";
            return View(model);
        }

        try
        {
            var result = await _riotDuoService.SearchAsync(model.Search, cancellationToken);
            model.Matches = result.Matches;
            model.Summary = result.Summary;

            if (model.Matches.Count == 0)
            {
                model.Message = "No shared matches were found in Riot's available match history. Check both Riot IDs and the routing region.";
            }
            else
            {
                model.Message = $"{model.Matches.Count} shared match{(model.Matches.Count == 1 ? string.Empty : "es")} found for the current selection.";
            }
        }
        catch (Exception ex)
        {
            model.Message = ex.Message;
            model.Matches.Clear();
            model.Summary = null;
        }

        return View(model);
    }

    [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
    public IActionResult Error()
    {
        return View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
    }
}
