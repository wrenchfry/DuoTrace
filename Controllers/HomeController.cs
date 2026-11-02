using System.Diagnostics;
using DuoTraceApp.Models;
using DuoTraceApp.Services;
using Microsoft.AspNetCore.Mvc;

namespace DuoTraceApp.Controllers;

public class HomeController : Controller
{
    private readonly IRiotDuoService _riotDuoService;

    public HomeController(IRiotDuoService riotDuoService)
    {
        _riotDuoService = riotDuoService;
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
                model.Message = "No shared matches match the current filters. Try all servers, a wider month, or remove the patch filter.";
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

    public IActionResult Privacy()
    {
        return View();
    }

    [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
    public IActionResult Error()
    {
        return View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
    }
}
