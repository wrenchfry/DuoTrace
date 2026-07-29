import './styles.css';

const regions = ['americas', 'europe', 'asia', 'sea'];

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

const matches = [];
const foundIds = new Set();

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

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  submitButton.textContent = 'Scanning...';
  clearResults();
  setMessage('Resolving Riot accounts.');

  try {
    const input = getLookupInput();
    await streamSharedMatches(input);

    if (!matches.length) {
      setMessage('No shared matches found in the available match history for both players.');
      return;
    }

    setMessage(`${matches.length} shared match${matches.length === 1 ? '' : 'es'} found.`);
  } catch (error) {
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

async function streamSharedMatches(input) {
  const response = await fetch('/api/shared-matches', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(input)
  });

  if (!response.ok || !response.body) {
    const detail = await safeJson(response);
    throw new Error(detail?.message || `Request failed with status ${response.status}.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      handleStreamEvent(JSON.parse(line));
    }
  }

  if (buffer.trim()) {
    handleStreamEvent(JSON.parse(buffer));
  }
}

function handleStreamEvent(event) {
  if (event.type === 'message') {
    setMessage(event.message);
    return;
  }

  if (event.type === 'match') {
    addMatch(event.match);
    return;
  }

  if (event.type === 'done') {
    setMessage(`${event.count} shared match${event.count === 1 ? '' : 'es'} found.`);
    return;
  }

  if (event.type === 'error') {
    throw new Error(event.message);
  }
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
