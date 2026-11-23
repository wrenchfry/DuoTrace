import './styles.css';

const regions = ['americas', 'europe', 'asia', 'sea'];
const patchSeasons = [
  { label: 'Current season', prefix: '16', patches: 23 },
  { label: '2025 season', prefix: '15', patches: 24 },
  { label: '2024 season', prefix: '14', patches: 24 }
];
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
          <span>uoTrace</span>
        </a>
      </nav>

      <div class="hero-copy">
        <h1>Find games two Riot IDs shared.</h1>
        <p>
          Compare two players across the match history Riot makes available. See the champions,
          KDA, queue, and whether they played together or against each other.
        </p>
      </div>
    </section>

    <section class="lookup-panel">
      <form id="lookupForm" class="lookup-form">
        <div class="lookup-heading">
          <div>
            <span class="eyebrow">Start a comparison</span>
            <h2>Choose two players</h2>
          </div>
          <p>Use the current Riot ID format: <strong>GameName#TAG</strong>.</p>
        </div>
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
            <span>Server region</span>
            <select id="region">
              ${regions.map((region) => `<option value="${region}">${titleCase(region)}</option>`).join('')}
            </select>
            <small>Choose the region where both players play.</small>
          </label>
        </div>

        <details class="advanced-filters">
          <summary>Advanced filters</summary>
          <div class="advanced-filter-grid">
            <label>
              <span>Patch</span>
              <select id="patchFilter">
                <option value="">Any patch</option>
                ${renderPatchOptions()}
              </select>
            </label>
            <label>
              <span>Month</span>
              <input id="monthFilter" type="month" />
            </label>
          </div>
        </details>

        <div class="actions">
          <button id="submitButton" type="submit">Find shared games</button>
          <button id="clearButton" type="button" class="secondary">Clear results</button>
          <small class="search-note">Searches use the selected server region. Use advanced filters only when you want to narrow results.</small>
        </div>
      </form>
    </section>

    <aside class="limitations-panel" aria-label="Data limitations">
      <strong>Data limits</strong>
      <p>
        DuoTrace can only find games Riot still makes available. Older games may disappear
        after around two years, and active players may have only their most recent matches available.
      </p>
    </aside>

    <section id="duoSummary" class="duo-summary" hidden aria-live="polite">
      <div class="duo-summary-header">
        <div>
          <span class="eyebrow">Duo analysis</span>
          <h2>Shared-game summary</h2>
        </div>
      </div>
      <div id="duoSummaryMetrics" class="duo-summary-grid"></div>
    </section>

    <section class="results" aria-live="polite">
      <div id="message" class="message" role="status">
        Enter both Riot IDs to search for shared matches.
      </div>
      <div id="resultList" class="result-list"></div>
    </section>
  </main>
`;

const form = document.querySelector('#lookupForm');
const message = document.querySelector('#message');
const resultList = document.querySelector('#resultList');
const duoSummary = document.querySelector('#duoSummary');
const duoSummaryMetrics = document.querySelector('#duoSummaryMetrics');
const submitButton = document.querySelector('#submitButton');
const clearButton = document.querySelector('#clearButton');
const region = document.querySelector('#region');
const patchFilter = document.querySelector('#patchFilter');
const monthFilter = document.querySelector('#monthFilter');
clearButton.addEventListener('click', () => {
  clearResults();
  setMessage('Enter both Riot IDs to search for shared matches.');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  submitButton.textContent = 'Scanning...';
  clearResults();
  setMessage('Resolving Riot accounts.');

  try {
    const input = getLookupInput();
    const filteredMatches = await resolveSharedMatches(input);

    if (!filteredMatches.length) {
      setMessage('No shared matches match the current filters. Try a different server region or clear the advanced filters.');
      return;
    }

    renderDuoSummary(filteredMatches, input);
    renderResults(filteredMatches);
    setMessage(`${filteredMatches.length} shared match${filteredMatches.length === 1 ? '' : 'es'} found for the current selection.`);
  } catch (error) {
    setMessage(error.message || 'Something went wrong while checking match history.');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Find shared games';
  }
});

function getLookupInput() {
  return {
    first: parseRiotId(document.querySelector('#playerOne').value),
    second: parseRiotId(document.querySelector('#playerTwo').value),
    region: region.value,
    patch: patchFilter.value.trim(),
    month: monthFilter.value
  };
}

function renderPatchOptions() {
  return patchSeasons.map(({ label, prefix, patches }) => `
    <optgroup label="${label}">
      ${Array.from({ length: patches }, (_, index) => {
        const patch = `${prefix}.${patches - index}`;
        return `<option value="${patch}">Patch ${patch}</option>`;
      }).join('')}
    </optgroup>
  `).join('');
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

async function resolveSharedMatches({ first, second, region: regionValue, patch, month }) {
  const client = createDuoTraceClient(regionValue);
  const [firstAccount, secondAccount] = await Promise.all([
    client.account(first),
    client.account(second)
  ]);
  const matched = await findSharedMatches(client, firstAccount.puuid, secondAccount.puuid);
  const filtered = applyDuoFilters(matched, { patch, month });
  return filtered;
}

async function findSharedMatches(client, firstPuuid, secondPuuid) {
  const [firstIds, secondIds] = await Promise.all([
    getAvailableMatchIds(client, firstPuuid),
    getAvailableMatchIds(client, secondPuuid)
  ]);
  const secondIdSet = new Set(secondIds);
  const sharedIds = firstIds.filter((matchId) => secondIdSet.has(matchId));
  const sharedMatches = [];

  for (const [index, matchId] of sharedIds.entries()) {
    setMessage(`Loading shared game ${index + 1} of ${sharedIds.length}.`);
    const match = await client.match(matchId);

    if (hasParticipants(match, firstPuuid, secondPuuid)) {
      sharedMatches.push(formatMatch(match, firstPuuid, secondPuuid));
    }
  }

  return sortMatches(sharedMatches);
}

async function getAvailableMatchIds(client, puuid) {
  const ids = [];
  let start = 0;
  let done = false;

  while (!done) {
    setMessage(`Scanning match history ${start + 1}-${start + batchSize}.`);
    const page = await client.matchIds(puuid, start);
    ids.push(...page);
    done = page.length < batchSize;
    start += batchSize;
  }

  return ids;
}

function createDuoTraceClient(region) {
  const request = async (path, body) => {
    while (true) {
      await reserveRequestSlot();
      const response = await fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ...body, region })
      });

      if (response.status === 429) {
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

  return {
    account: (account) => request('/api/account', { account }),
    matchIds: (puuid, start) => request('/api/match-ids', { puuid, start }),
    match: (matchId) => request('/api/match', { matchId })
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
    patch: extractPatch(match.info.gameVersion),
    monthKey: formatMonthKey(match.info.gameCreation),
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

function applyDuoFilters(matches, { patch, month }) {
  const normalizedPatch = patch?.trim();
  const normalizedMonth = month?.trim();

  return matches.filter((match) => {
    if (normalizedPatch && match.patch !== normalizedPatch) {
      return false;
    }

    if (normalizedMonth && match.monthKey !== normalizedMonth) {
      return false;
    }

    return true;
  });
}

function renderDuoSummary(matches) {
  if (!matches.length) {
    duoSummary.hidden = true;
    duoSummaryMetrics.innerHTML = '';
    return;
  }

  const sameTeamMatches = matches.filter((match) => match.first.teamId === match.second.teamId);
  const sameTeamWins = sameTeamMatches.filter((match) => match.first.win && match.second.win).length;
  const queueCounts = countBy(matches, (match) => match.queue);
  const championPairs = countBy(matches, (match) => `${match.first.champion} + ${match.second.champion}`);
  const bestQueue = [...queueCounts.entries()].sort(([, first], [, second]) => second - first)[0];
  const bestPair = [...championPairs.entries()].sort(([, first], [, second]) => second - first)[0];

  duoSummaryMetrics.innerHTML = [
    metricCard('Shared games', matches.length),
    metricCard('Games as a duo', sameTeamMatches.length),
    metricCard('Same-team win rate', formatPercentage(getWinRate(sameTeamWins, sameTeamMatches.length))),
    metricCard('Most-played queue', bestQueue ? bestQueue[0] : '—'),
    metricCard('Most-played pair', bestPair ? bestPair[0] : '—')
  ].join('');

  duoSummary.hidden = false;
}

function metricCard(label, value) {
  return `
    <article class="summary-metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `;
}

function countBy(items, getter) {
  return items.reduce((counts, item) => {
    const key = getter(item);
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map());
}

function getWinRate(wins, total) {
  if (!total) {
    return 0;
  }

  return wins / total;
}

function formatPercentage(value) {
  return `${Math.round(value * 100)}%`;
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

function clearResults() {
  resultList.innerHTML = '';
  duoSummary.hidden = true;
  duoSummaryMetrics.innerHTML = '';
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
            <dt>Patch</dt>
            <dd>${escapeHtml(match.patch || 'Unknown')}</dd>
          </div>
        </dl>

        <div class="match-actions">
          ${matchUrl ? `<a href="${escapeHtml(matchUrl)}" target="_blank" rel="noreferrer">Open match page</a>` : ''}
        </div>
      </article>
    `;
  }).join('');
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

function extractPatch(gameVersion) {
  const match = String(gameVersion || '').match(/\d+\.\d+/);
  return match ? match[0] : 'unknown';
}

function formatMonthKey(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
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
