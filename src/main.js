import './styles.css';

const regions = ['americas', 'europe', 'asia', 'sea'];
const batchSize = 100;
const requestDelayMs = 1300;
const fallbackRateLimitSeconds = 120;

let nextRequestAt = 0;
let requestQueue = Promise.resolve();

const queueNames = new Map([
  [400, 'Draft Pick'],
  [420, 'Ranked Solo/Duo'],
  [430, 'Blind Pick'],
  [440, 'Ranked Flex'],
  [450, 'ARAM'],
  [480, 'Swiftplay'],
  [700, 'Clash'],
  [830, 'Intro Bots'],
  [840, 'Beginner Bots'],
  [850, 'Intermediate Bots'],
  [900, 'URF'],
  [1020, 'One for All'],
  [1300, 'Nexus Blitz'],
  [1400, 'Ultimate Spellbook'],
  [1700, 'Arena'],
  [1810, 'Swarm'],
  [1820, 'Swarm'],
  [1830, 'Swarm'],
  [1840, 'Swarm'],
  [1900, 'URF']
]);

document.querySelector('#app').innerHTML = `
  <main class="shell">
    <section class="hero">
      <nav class="topbar" aria-label="DuoTrace">
        <a class="brand" href="./" aria-label="DuoTrace home">
          <span class="brand-mark" aria-hidden="true">D</span>
          <span>DuoTrace</span>
        </a>
      </nav>

      <div class="hero-grid">
        <div class="hero-copy">
          <h1>Find games two Riot IDs shared.</h1>
          <p>
            Enter two players and scan match history from newest to oldest available.
          </p>
        </div>
        <aside class="summary-card" aria-live="polite">
          <span>Scan mode</span>
          <strong id="scanLabel">Full available history</strong>
          <small id="regionLabel">Routing: Americas</small>
        </aside>
      </div>
    </section>

    <section class="lookup-panel">
      <form id="lookupForm" class="lookup-form">
        <div class="form-grid">
          <label>
            <span>First Riot ID</span>
            <input id="playerOne" autocomplete="off" spellcheck="false" placeholder="GameName#TAG" required />
          </label>
          <label>
            <span>Second Riot ID</span>
            <input id="playerTwo" autocomplete="off" spellcheck="false" placeholder="SecondName#TAG" required />
          </label>
          <label>
            <span>Routing region</span>
            <select id="region">
              ${regions.map((region) => `<option value="${region}">${titleCase(region)}</option>`).join('')}
            </select>
          </label>
        </div>

        <div class="actions">
          <button id="submitButton" type="submit">Check shared games</button>
          <button id="clearButton" type="button" class="secondary">Clear results</button>
        </div>
      </form>
    </section>

    <aside class="limitations-panel" aria-label="Data limitations">
      <strong>Data limits</strong>
      <p>
        DuoTrace can only find games Riot still makes available. Older games may disappear
        after about 2 years, and very active players may only have roughly their latest
        1,000 games available to search.
      </p>
    </aside>

    <section class="results" aria-live="polite">
      <div id="message" class="message">
        Enter both Riot IDs to search for shared matches.
      </div>
      <section id="dashboard" class="dashboard" hidden aria-label="DuoTrace analytics dashboard">
        <div class="dashboard-heading">
          <div>
            <span class="eyebrow">DuoTrace analytics</span>
            <h2>Shared-game insights</h2>
          </div>
          <div class="dashboard-tabs" role="tablist" aria-label="Dashboard pages">
            <button class="dashboard-tab is-active" type="button" role="tab" aria-selected="true" aria-controls="insightsPage" data-dashboard-page="insights">Duo insights</button>
            <button class="dashboard-tab" type="button" role="tab" aria-selected="false" aria-controls="healthPage" data-dashboard-page="health">Search health</button>
          </div>
        </div>

        <div id="insightsPage" class="dashboard-page" role="tabpanel">
          <div id="insightMetrics" class="metric-grid"></div>
          <div class="dashboard-grid">
            <article class="dashboard-card">
              <span class="card-label">Queue distribution</span>
              <div id="queueBreakdown" class="breakdown-list"></div>
            </article>
            <article class="dashboard-card">
              <span class="card-label">Most common champion pairings</span>
              <div id="championBreakdown" class="breakdown-list"></div>
            </article>
          </div>
          <article class="dashboard-card activity-card">
            <span class="card-label">Shared games over time</span>
            <div id="activityBreakdown" class="activity-list"></div>
          </article>
        </div>

        <div id="healthPage" class="dashboard-page" role="tabpanel" hidden>
          <div id="healthMetrics" class="metric-grid"></div>
          <article class="dashboard-card health-note">
            <span class="card-label">What this run verifies</span>
            <p id="healthSummary"></p>
          </article>
        </div>
      </section>
      <div id="resultList" class="result-list"></div>
    </section>
  </main>
`;

const form = document.querySelector('#lookupForm');
const message = document.querySelector('#message');
const resultList = document.querySelector('#resultList');
const submitButton = document.querySelector('#submitButton');
const clearButton = document.querySelector('#clearButton');
const region = document.querySelector('#region');
const regionLabel = document.querySelector('#regionLabel');
const dashboard = document.querySelector('#dashboard');
const insightMetrics = document.querySelector('#insightMetrics');
const queueBreakdown = document.querySelector('#queueBreakdown');
const championBreakdown = document.querySelector('#championBreakdown');
const activityBreakdown = document.querySelector('#activityBreakdown');
const healthMetrics = document.querySelector('#healthMetrics');
const healthSummary = document.querySelector('#healthSummary');

const matches = [];
const foundIds = new Set();
let scanMetrics = createScanMetrics();

updateRegionLabel();

window.addEventListener('pageshow', updateRegionLabel);
region.addEventListener('change', updateRegionLabel);

function updateRegionLabel() {
  regionLabel.textContent = `Routing: ${titleCase(region.value)}`;
}

clearButton.addEventListener('click', () => {
  clearResults();
  setMessage('Enter both Riot IDs to search for shared matches.');
});

document.querySelectorAll('[data-dashboard-page]').forEach((button) => {
  button.addEventListener('click', () => setDashboardPage(button.dataset.dashboardPage));
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  submitButton.textContent = 'Scanning...';
  clearResults();
  scanMetrics = createScanMetrics();
  setMessage('Resolving Riot accounts.');

  try {
    const input = getLookupInput();
    const client = createDuoTraceClient(input.region);
    const [firstAccount, secondAccount] = await Promise.all([
      client.account(input.first),
      client.account(input.second)
    ]);

    const sharedMatches = await findSharedMatches(client, firstAccount.puuid, secondAccount.puuid);
    void client.recordSearch({
      first: input.first,
      second: input.second,
      matches: sharedMatches
    }).catch(() => undefined);

    if (!sharedMatches.length) {
      finishScan('complete');
      renderDashboard();
      setMessage('No shared matches found in the available match history for both players.');
      return;
    }

    finishScan('complete');
    renderDashboard();
    setMessage(`${sharedMatches.length} shared match${sharedMatches.length === 1 ? '' : 'es'} found.`);
  } catch (error) {
    finishScan('failed', error.message);
    renderDashboard();
    setMessage(error.message || 'Something went wrong while checking match history.');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Check shared games';
  }
});

function getLookupInput() {
  return {
    first: parseRiotId(document.querySelector('#playerOne').value),
    second: parseRiotId(document.querySelector('#playerTwo').value),
    region: region.value
  };
}

function parseRiotId(value) {
  const parts = value.trim().split('#');

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('Use Riot ID format GameName#TAG for both players.');
  }

  return {
    gameName: parts[0].trim(),
    tagLine: parts[1].trim()
  };
}

function createDuoTraceClient(region) {
  const request = async (path, body, metric) => {
    while (true) {
      await reserveRequestSlot();
      scanMetrics[metric] += 1;
      const response = await fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ...body, region })
      });

      if (response.status === 429) {
        scanMetrics.rateLimitRetries += 1;
        const detail = await safeJson(response);
        const retryAfter = detail?.retryAfter || fallbackRateLimitSeconds;
        setMessage(`Riot rate limit reached. Waiting ${retryAfter} second${retryAfter === 1 ? '' : 's'} before continuing.`);
        nextRequestAt = Date.now() + (retryAfter * 1000);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (!response.ok) {
        const detail = await safeJson(response);
        throw new Error(detail?.message || `Request failed with status ${response.status}.`);
      }

      return response.json();
    }
  };

  const recordSearch = async (search) => {
    const response = await fetch('/api/analytics/searches', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ...search, region })
    });

    if (!response.ok) {
      throw new Error('Search analytics could not be recorded.');
    }
  };

  return {
    account: (account) => request('/api/account', { account }, 'accountRequests'),
    matchIds: (puuid, start) => request('/api/match-ids', { puuid, start }, 'historyRequests'),
    match: (matchId) => request('/api/match', { matchId }, 'matchRequests'),
    recordSearch
  };
}

function reserveRequestSlot() {
  requestQueue = requestQueue.then(waitForRequestSlot, waitForRequestSlot);
  return requestQueue;
}

async function waitForRequestSlot() {
  const waitMs = nextRequestAt - Date.now();

  if (waitMs > 0) {
    await sleep(waitMs);
  }

  nextRequestAt = Math.max(Date.now(), nextRequestAt) + requestDelayMs;
}

async function findSharedMatches(client, firstPuuid, secondPuuid) {
  const [firstIds, secondIds] = await getAvailableMatchIds(client, firstPuuid, secondPuuid);
  const firstIdSet = new Set(firstIds);
  const secondIdSet = new Set(secondIds);
  const overlappingIds = firstIds.filter((matchId) => secondIdSet.has(matchId));
  const oneSidedIds = [
    ...firstIds.filter((matchId) => !secondIdSet.has(matchId)),
    ...secondIds.filter((matchId) => !firstIdSet.has(matchId))
  ];
  scanMetrics.candidateMatches = overlappingIds.length + oneSidedIds.length;

  await loadSharedMatches({
    client,
    matchIds: overlappingIds,
    firstPuuid,
    secondPuuid,
    label: 'Loading confirmed shared match'
  });

  await loadSharedMatches({
    client,
    matchIds: oneSidedIds,
    firstPuuid,
    secondPuuid,
    label: 'Verifying possible shared match'
  });

  return sortMatches(matches);
}

async function loadSharedMatches({ client, matchIds, firstPuuid, secondPuuid, label }) {
  for (const [index, matchId] of matchIds.entries()) {
    setMessage(`${label} ${index + 1} of ${matchIds.length}. Found ${matches.length} shared.`);
    const match = await client.match(matchId);

    if (hasParticipants(match, firstPuuid, secondPuuid)) {
      addMatch(formatMatch(match, firstPuuid, secondPuuid));
    }
  }
}

async function getAvailableMatchIds(client, firstPuuid, secondPuuid) {
  const firstIds = [];
  const secondIds = [];
  let start = 0;
  let firstDone = false;
  let secondDone = false;

  while (!firstDone || !secondDone) {
    setMessage(`Scanning games ${start + 1}-${start + batchSize}.`);

    const [firstPage, secondPage] = await Promise.all([
      firstDone ? [] : client.matchIds(firstPuuid, start),
      secondDone ? [] : client.matchIds(secondPuuid, start)
    ]);

    firstDone = firstPage.length < batchSize;
    secondDone = secondPage.length < batchSize;

    firstIds.push(...firstPage);
    secondIds.push(...secondPage);
    start += batchSize;
  }

  return [firstIds, secondIds];
}

function hasParticipants(match, firstPuuid, secondPuuid) {
  return match.metadata.participants.includes(firstPuuid)
    && match.metadata.participants.includes(secondPuuid);
}

function formatMatch(match, firstPuuid, secondPuuid) {
  const first = match.info.participants.find((participant) => participant.puuid === firstPuuid);
  const second = match.info.participants.find((participant) => participant.puuid === secondPuuid);

  return {
    id: match.metadata.matchId,
    queueId: match.info.queueId,
    queue: queueNames.get(match.info.queueId) || `Queue ${match.info.queueId}`,
    startedAt: new Date(match.info.gameCreation),
    duration: formatDuration(match.info.gameDuration),
    gameMode: match.info.gameMode,
    first: formatParticipant(first),
    second: formatParticipant(second)
  };
}

function formatParticipant(participant) {
  return {
    name: participant.riotIdGameName
      ? `${participant.riotIdGameName}#${participant.riotIdTagline}`
      : participant.summonerName,
    champion: participant.championName,
    teamId: participant.teamId,
    win: participant.win,
    kda: `${participant.kills}/${participant.deaths}/${participant.assists}`
  };
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addMatch(match) {
  if (foundIds.has(match.id)) {
    return;
  }

  foundIds.add(match.id);
  matches.push({
    ...match,
    startedAt: new Date(match.startedAt)
  });
  renderResults(sortMatches(matches));
}

function clearResults() {
  matches.length = 0;
  foundIds.clear();
  resultList.innerHTML = '';
  dashboard.hidden = true;
}

function createScanMetrics() {
  return {
    startedAt: new Date(),
    endedAt: null,
    status: 'running',
    error: '',
    accountRequests: 0,
    historyRequests: 0,
    matchRequests: 0,
    candidateMatches: 0,
    rateLimitRetries: 0
  };
}

function finishScan(status, error = '') {
  scanMetrics.status = status;
  scanMetrics.error = error;
  scanMetrics.endedAt = new Date();
}

function renderDashboard() {
  const sortedMatches = sortMatches(matches);
  dashboard.hidden = false;
  insightMetrics.innerHTML = [
    metricCard('Shared matches', sortedMatches.length),
    metricCard('Same team', sortedMatches.filter((match) => match.first.teamId === match.second.teamId).length),
    metricCard('Opponents', sortedMatches.filter((match) => match.first.teamId !== match.second.teamId).length),
    metricCard('Duo win rate', formatPercentage(getDuoWinRate(sortedMatches)))
  ].join('');

  renderBreakdown(queueBreakdown, countBy(sortedMatches, (match) => match.queue), 'No shared games found.');
  renderBreakdown(
    championBreakdown,
    countBy(sortedMatches, (match) => `${match.first.champion} + ${match.second.champion}`),
    'No shared games found.'
  );
  renderActivity(sortedMatches);

  const totalRequests = scanMetrics.accountRequests + scanMetrics.historyRequests + scanMetrics.matchRequests;
  healthMetrics.innerHTML = [
    metricCard('Search status', scanMetrics.status === 'complete' ? 'Healthy' : 'Needs attention', scanMetrics.status),
    metricCard('Last checked', formatShortDate(scanMetrics.endedAt || scanMetrics.startedAt)),
    metricCard('API requests', totalRequests),
    metricCard('Rate-limit retries', scanMetrics.rateLimitRetries)
  ].join('');

  healthSummary.textContent = buildHealthSummary(totalRequests);
}

function setDashboardPage(page) {
  const isInsights = page === 'insights';
  document.querySelector('#insightsPage').hidden = !isInsights;
  document.querySelector('#healthPage').hidden = isInsights;

  document.querySelectorAll('[data-dashboard-page]').forEach((button) => {
    const selected = button.dataset.dashboardPage === page;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
}

function metricCard(label, value, tone = '') {
  return `
    <article class="metric-card ${escapeHtml(tone)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `;
}

function countBy(items, getLabel) {
  return items.reduce((counts, item) => {
    const label = getLabel(item);
    counts.set(label, (counts.get(label) || 0) + 1);
    return counts;
  }, new Map());
}

function renderBreakdown(container, counts, emptyMessage) {
  const entries = [...counts.entries()].sort(([, firstCount], [, secondCount]) => secondCount - firstCount).slice(0, 5);

  if (!entries.length) {
    container.innerHTML = `<p class="empty-state">${escapeHtml(emptyMessage)}</p>`;
    return;
  }

  const maximum = entries[0][1];
  container.innerHTML = entries.map(([label, count]) => `
    <div class="breakdown-row">
      <div><span>${escapeHtml(label)}</span><strong>${count}</strong></div>
      <i><b style="width: ${(count / maximum) * 100}%"></b></i>
    </div>
  `).join('');
}

function renderActivity(sortedMatches) {
  const entries = [...countBy(sortedMatches, (match) => new Intl.DateTimeFormat(undefined, {
    month: 'short',
    year: 'numeric'
  }).format(match.startedAt)).entries()].reverse().slice(-6);

  if (!entries.length) {
    activityBreakdown.innerHTML = '<p class="empty-state">No shared games found.</p>';
    return;
  }

  const maximum = Math.max(...entries.map(([, count]) => count));
  activityBreakdown.innerHTML = entries.map(([label, count]) => `
    <div class="activity-row">
      <span>${escapeHtml(label)}</span>
      <div><i style="height: ${Math.max(14, (count / maximum) * 100)}%"></i><strong>${count}</strong></div>
    </div>
  `).join('');
}

function getDuoWinRate(currentMatches) {
  const sameTeamMatches = currentMatches.filter((match) => match.first.teamId === match.second.teamId);

  if (!sameTeamMatches.length) {
    return null;
  }

  return sameTeamMatches.filter((match) => match.first.win && match.second.win).length / sameTeamMatches.length;
}

function formatPercentage(value) {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function formatShortDate(date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function buildHealthSummary(totalRequests) {
  if (scanMetrics.status === 'failed') {
    return `This scan stopped after ${totalRequests} API request${totalRequests === 1 ? '' : 's'}. ${scanMetrics.error || 'Check the API response and retry the scan.'}`;
  }

  return `This scan resolved two Riot accounts, read ${scanMetrics.historyRequests} match-history page${scanMetrics.historyRequests === 1 ? '' : 's'}, and checked ${scanMetrics.candidateMatches} possible shared match${scanMetrics.candidateMatches === 1 ? '' : 'es'}. ${scanMetrics.rateLimitRetries ? `It retried ${scanMetrics.rateLimitRetries} time${scanMetrics.rateLimitRetries === 1 ? '' : 's'} after Riot rate limiting.` : 'No Riot rate-limit retries were needed.'}`;
}

function renderResults(matches) {
  resultList.innerHTML = matches.map((match) => {
    const together = match.first.teamId === match.second.teamId;
    const matchUrl = getLeagueOfGraphsUrl(match);
    const queue = queueNames.get(match.queueId) || match.queue;

    return `
      <article class="match-card">
        <div class="match-heading">
          <div>
            <span class="match-date">${escapeHtml(formatDate(match.startedAt))}</span>
            <h2>${escapeHtml(queue)}</h2>
          </div>
          <span class="team-chip">${together ? 'Same team' : 'Opposite teams'}</span>
        </div>

        <div class="players">
          ${renderPlayer(match.first)}
          ${renderPlayer(match.second)}
        </div>

        <dl class="meta-grid">
          <div>
            <dt>Duration</dt>
            <dd>${escapeHtml(match.duration)}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>${escapeHtml(match.gameMode)}</dd>
          </div>
          <div>
            <dt>Match ID</dt>
            <dd>${escapeHtml(match.id)}</dd>
          </div>
        </dl>

        <div class="match-actions">
          <button class="copy-button" type="button" data-copy="${escapeHtml(match.id)}">Copy match ID</button>
          ${matchUrl ? `<a href="${escapeHtml(matchUrl)}" target="_blank" rel="noreferrer">Open match page</a>` : ''}
        </div>
      </article>
    `;
  }).join('');

  document.querySelectorAll('.copy-button').forEach((button) => {
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = 'Copied';
      setTimeout(() => {
        button.textContent = 'Copy match ID';
      }, 1400);
    });
  });
}

function renderPlayer(player) {
  return `
    <div class="player-card ${player.win ? 'winner' : ''}">
      <span>${escapeHtml(player.name)}</span>
      <strong>${escapeHtml(player.champion)}</strong>
      <small>${escapeHtml(player.kda)} - ${player.win ? 'Win' : 'Loss'}</small>
    </div>
  `;
}

function getLeagueOfGraphsUrl(match) {
  const [platform, numericId] = match.id.split('_');
  const regionSlug = platform?.replace(/[0-9]/g, '').toLowerCase();

  if (!regionSlug || !numericId) {
    return '';
  }

  return `https://www.leagueofgraphs.com/match/${regionSlug}/${numericId}`;
}

function setMessage(text) {
  message.textContent = text;
}

function formatDate(date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function sortMatches(matches) {
  return [...matches].sort((first, second) => second.startedAt - first.startedAt);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
