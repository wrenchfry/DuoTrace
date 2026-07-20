import './styles.css';

const regions = ['americas', 'europe', 'asia', 'sea'];
const batchSize = 100;
const requestDelayMs = 1300;
const fallbackRateLimitSeconds = 120;
const matchCachePrefix = 'duotrace:match:v1:';

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
        <a class="nav-link" href="https://developer.riotgames.com/" target="_blank" rel="noreferrer">Get a Riot key</a>
      </nav>

      <div class="hero-grid">
        <div class="hero-copy">
          <h1>Find games two Riot IDs shared.</h1>
          <p>
            Paste your Riot API key, enter two players, and scan match history from
            newest to oldest available.
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
        <label class="key-field">
          <span>Riot API key</span>
          <input id="apiKey" type="password" autocomplete="off" spellcheck="false" placeholder="RGAPI-..." required />
        </label>

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

    <section class="results" aria-live="polite">
      <div id="message" class="message">
        Enter both Riot IDs to search for shared matches.
      </div>
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
const apiKey = document.querySelector('#apiKey');

updateRegionLabel();

window.addEventListener('pageshow', updateRegionLabel);

apiKey.addEventListener('input', () => {
  const normalized = normalizeApiKey(apiKey.value);

  if (apiKey.value !== normalized) {
    apiKey.value = normalized;
  }
});

region.addEventListener('change', updateRegionLabel);

function updateRegionLabel() {
  regionLabel.textContent = `Routing: ${titleCase(region.value)}`;
}

clearButton.addEventListener('click', () => {
  resultList.innerHTML = '';
  setMessage('Enter both Riot IDs to search for shared matches.');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  submitButton.textContent = 'Scanning...';
  resultList.innerHTML = '';
  setMessage('Resolving Riot accounts.');

  try {
    const input = getLookupInput();
    const client = createRiotClient(input);
    const [firstAccount, secondAccount] = await Promise.all([
      client.account(input.first),
      client.account(input.second)
    ]);

    const matches = await findSharedMatches(client, firstAccount.puuid, secondAccount.puuid);

    if (!matches.length) {
      setMessage('No shared matches found in the available match history for both players.');
      return;
    }

    renderResults(matches);
    setMessage(`${matches.length} shared match${matches.length === 1 ? '' : 'es'} found.`);
  } catch (error) {
    setMessage(error.message || 'Something went wrong while checking match history.');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Check shared games';
  }
});

function getLookupInput() {
  const normalizedApiKey = normalizeApiKey(apiKey.value);
  apiKey.value = normalizedApiKey;

  if (!/^RGAPI-[0-9a-f-]{36}$/i.test(normalizedApiKey)) {
    throw new Error('Use the full Riot development key format: RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.');
  }

  return {
    apiKey: normalizedApiKey,
    first: parseRiotId(document.querySelector('#playerOne').value),
    second: parseRiotId(document.querySelector('#playerTwo').value),
    region: region.value
  };
}

function normalizeApiKey(value) {
  return value
    .replace(/[\s\u200B-\u200D\uFEFF]/g, '')
    .trim();
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

function createRiotClient(input) {
  const request = async (path) => {
    const response = await fetchWithRetry(`https://${input.region}.api.riotgames.com${path}`, {
      headers: {
        'X-Riot-Token': input.apiKey
      }
    });

    if (!response.ok) {
      const detail = await safeJson(response);
      const status = detail?.status?.message || response.statusText;

      if (response.status === 401 && status.toLowerCase().includes('apikey')) {
        throw new Error('Riot did not accept that API key. Paste a fresh RGAPI key from the Riot developer portal; development keys expire and stop working even when the format looks correct.');
      }

      throw new Error(`Riot API returned ${response.status}: ${status}`);
    }

    return response.json();
  };

  return {
    account: ({ gameName, tagLine }) => request(`/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`),
    matchIds: (puuid, start) => request(`/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?start=${start}&count=${batchSize}`),
    match: async (matchId) => {
      const cached = readCachedMatch(input.region, matchId);

      if (cached) {
        return cached;
      }

      const match = normalizeMatch(await request(`/lol/match/v5/matches/${encodeURIComponent(matchId)}`));
      writeCachedMatch(input.region, match);
      return match;
    }
  };
}

async function fetchWithRetry(url, options) {
  while (true) {
    await reserveRequestSlot();
    const response = await fetch(url, options);

    if (response.status !== 429) {
      return response;
    }

    const retryAfter = getRetryAfterSeconds(response);
    setMessage(`Riot rate limit reached. Waiting ${retryAfter} second${retryAfter === 1 ? '' : 's'} before continuing.`);
    nextRequestAt = Date.now() + (retryAfter * 1000);
    await sleep(retryAfter * 1000);
  }
}

function reserveRequestSlot() {
  requestQueue = requestQueue.then(waitForRequestSlot, waitForRequestSlot);
  return requestQueue;
}

async function waitForRequestSlot() {
  const now = Date.now();
  const waitMs = nextRequestAt - now;

  if (waitMs > 0) {
    await sleep(waitMs);
  }

  nextRequestAt = Math.max(Date.now(), nextRequestAt) + requestDelayMs;
}

function getRetryAfterSeconds(response) {
  const retryAfter = Number(response.headers.get('retry-after'));

  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.ceil(retryAfter);
  }

  return fallbackRateLimitSeconds;
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
  const matches = [];
  const foundIds = new Set();

  await loadSharedMatches({
    client,
    matchIds: overlappingIds,
    matches,
    foundIds,
    firstPuuid,
    secondPuuid,
    label: 'Loading confirmed shared match'
  });

  await loadSharedMatches({
    client,
    matchIds: oneSidedIds,
    matches,
    foundIds,
    firstPuuid,
    secondPuuid,
    label: 'Verifying possible shared match'
  });

  return sortMatches(matches);
}

async function loadSharedMatches({ client, matchIds, matches, foundIds, firstPuuid, secondPuuid, label }) {
  for (const [index, matchId] of matchIds.entries()) {
    setMessage(`${label} ${index + 1} of ${matchIds.length}. Found ${matches.length} shared.`);
    const match = await client.match(matchId);

    if (hasParticipants(match, firstPuuid, secondPuuid) && !foundIds.has(match.metadata.matchId)) {
      foundIds.add(match.metadata.matchId);
      matches.push(formatMatch(match, firstPuuid, secondPuuid));
      renderResults(sortMatches(matches));
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

function normalizeMatch(match) {
  return {
    metadata: {
      matchId: match.metadata.matchId,
      participants: match.metadata.participants
    },
    info: {
      queueId: match.info.queueId,
      gameCreation: match.info.gameCreation,
      gameDuration: match.info.gameDuration,
      gameMode: match.info.gameMode,
      participants: match.info.participants.map((participant) => ({
        puuid: participant.puuid,
        riotIdGameName: participant.riotIdGameName,
        riotIdTagline: participant.riotIdTagline,
        summonerName: participant.summonerName,
        championName: participant.championName,
        teamId: participant.teamId,
        win: participant.win,
        kills: participant.kills,
        deaths: participant.deaths,
        assists: participant.assists
      }))
    }
  };
}

function readCachedMatch(region, matchId) {
  try {
    const cached = localStorage.getItem(getMatchCacheKey(region, matchId));
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

function writeCachedMatch(region, match) {
  try {
    localStorage.setItem(getMatchCacheKey(region, match.metadata.matchId), JSON.stringify(match));
  } catch {
    // Browsers can reject storage when private mode or quota limits are active.
  }
}

function getMatchCacheKey(region, matchId) {
  return `${matchCachePrefix}${region}:${matchId}`;
}

function sortMatches(matches) {
  return [...matches].sort((first, second) => second.startedAt - first.startedAt);
}

function formatMatch(match, firstPuuid, secondPuuid) {
  const first = match.info.participants.find((participant) => participant.puuid === firstPuuid);
  const second = match.info.participants.find((participant) => participant.puuid === secondPuuid);

  return {
    id: match.metadata.matchId,
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

function renderResults(matches) {
  resultList.innerHTML = matches.map((match) => {
    const together = match.first.teamId === match.second.teamId;
    const matchUrl = getLeagueOfGraphsUrl(match);

    return `
      <article class="match-card">
        <div class="match-heading">
          <div>
            <span class="match-date">${escapeHtml(formatDate(match.startedAt))}</span>
            <h2>${escapeHtml(match.queue)}</h2>
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

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
