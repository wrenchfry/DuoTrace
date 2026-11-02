const searchForm = document.querySelector(".lookup-form[data-start-url]");
const regionSelect = document.querySelector("#Search_Region");
const routingSummary = document.querySelector("#routing-summary");

if (regionSelect && routingSummary) {
    const updateRoutingSummary = () => {
        const selectedRegion = regionSelect.selectedOptions[0]?.textContent.trim();
        routingSummary.textContent = `Routing: ${selectedRegion || "All regions"}`;
    };

    regionSelect.addEventListener("change", updateRoutingSummary);
    updateRoutingSummary();
}

if (searchForm) {
    const statusPanel = document.querySelector("#search-status");
    const statusMessage = document.querySelector("#search-status-message");
    const summaryPanel = document.querySelector("#duo-summary");
    const summaryGrid = document.querySelector("#duo-summary-grid");
    const resultsPanel = document.querySelector("#match-results");
    const submitButton = searchForm.querySelector('button[type="submit"]');
    let activeSearch = 0;

    const makeElement = (tagName, className, text) => {
        const element = document.createElement(tagName);
        if (className) {
            element.className = className;
        }
        if (text !== undefined) {
            element.textContent = text;
        }
        return element;
    };

    const setSummary = (summary) => {
        summaryGrid.replaceChildren();
        const stats = [
            ["Shared games", summary.games],
            ["Duo games", summary.sameTeamGames],
            ["Duo win rate", Number(summary.duoWinRate).toLocaleString(undefined, {
                style: "percent",
                maximumFractionDigits: 0
            })]
        ];

        for (const [label, value] of stats) {
            const card = makeElement("article", "summary-metric-card");
            card.append(makeElement("span", "", String(label)));
            card.append(makeElement("strong", "", String(value)));
            summaryGrid.append(card);
        }

        summaryPanel.classList.remove("is-hidden");
    };

    const setMatchResults = (matches) => {
        resultsPanel.replaceChildren();

        for (const match of matches) {
            const card = makeElement("article", "match-card");
            const heading = makeElement("div", "match-heading");
            const title = makeElement("div");
            const date = new Date(match.startedAt);
            title.append(makeElement("span", "match-date", Number.isNaN(date.valueOf())
                ? ""
                : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })));
            title.append(makeElement("h3", "", match.queue));
            heading.append(title);
            heading.append(makeElement("span", "team-chip", match.sameTeam ? "Same team" : "Opposite teams"));
            card.append(heading);

            const players = makeElement("div", "players");
            for (const player of [match.firstPlayer, match.secondPlayer]) {
                const playerCard = makeElement("div", `player-card${player.win ? " winner" : ""}`);
                playerCard.append(makeElement("span", "", player.name));
                playerCard.append(makeElement("strong", "", player.champion));
                playerCard.append(makeElement("small", "", `${player.kda} - ${player.win ? "Win" : "Loss"}`));
                players.append(playerCard);
            }
            card.append(players);

            const metadata = makeElement("dl", "meta-grid");
            for (const [label, value] of [
                ["Duration", match.duration],
                ["Mode", match.gameMode],
                ["Patch", match.patch],
                ["Match ID", match.matchId]
            ]) {
                const item = makeElement("div");
                item.append(makeElement("dt", "", label));
                item.append(makeElement("dd", "", value));
                metadata.append(item);
            }
            card.append(metadata);

            if (match.matchUrl) {
                const actions = makeElement("div", "match-actions");
                const link = makeElement("a", "", "Open match page");
                link.href = match.matchUrl;
                link.target = "_blank";
                link.rel = "noreferrer";
                actions.append(link);
                card.append(actions);
            }

            resultsPanel.append(card);
        }

        resultsPanel.classList.toggle("is-hidden", matches.length === 0);
    };

    const displayStatus = (snapshot) => {
        statusPanel.classList.remove("is-hidden");
        statusPanel.classList.toggle("is-complete", snapshot.state === "completed");
        statusPanel.classList.toggle("is-failed", snapshot.state === "failed");
        statusMessage.textContent = snapshot.message;
        setMatchResults(snapshot.matches || []);

        if ((snapshot.matches || []).length > 0) {
            setSummary(snapshot.summary);
        } else {
            summaryPanel.classList.add("is-hidden");
        }
    };

    const delay = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

    searchForm.addEventListener("submit", async event => {
        event.preventDefault();
        const searchId = ++activeSearch;
        const originalButtonText = submitButton.textContent;
        submitButton.disabled = true;
        submitButton.textContent = "Finding recent games…";
        summaryPanel.classList.add("is-hidden");
        resultsPanel.classList.add("is-hidden");
        statusPanel.classList.remove("is-hidden", "is-complete", "is-failed");
        statusMessage.textContent = "Starting your search.";

        try {
            const response = await fetch(searchForm.dataset.startUrl, {
                method: "POST",
                body: new FormData(searchForm),
                headers: { Accept: "application/json" },
                credentials: "same-origin"
            });
            const initialStatus = await response.json();
            if (!response.ok) {
                throw new Error(initialStatus.message || "Unable to start the search.");
            }

            let snapshot = initialStatus;
            displayStatus(snapshot);
            while (snapshot.state === "searching" && searchId === activeSearch) {
                await delay(800);
                const statusUrl = new URL(searchForm.dataset.statusUrl, window.location.href);
                statusUrl.searchParams.set("id", snapshot.id);
                const statusResponse = await fetch(statusUrl, {
                    headers: { Accept: "application/json" },
                    credentials: "same-origin"
                });
                if (!statusResponse.ok) {
                    throw new Error("The search status is no longer available. Please start a new search.");
                }

                snapshot = await statusResponse.json();
                displayStatus(snapshot);
            }
        } catch (error) {
            statusPanel.classList.remove("is-hidden", "is-complete");
            statusPanel.classList.add("is-failed");
            statusMessage.textContent = error instanceof Error ? error.message : "The search failed.";
        } finally {
            if (searchId === activeSearch) {
                submitButton.disabled = false;
                submitButton.textContent = originalButtonText;
            }
        }
    });
}
