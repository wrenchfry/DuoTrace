const regions = new Set(['americas', 'europe', 'asia', 'sea']);
const batchSize = 100;
const requestDelayMs = 1300;
const fallbackRateLimitSeconds = 120;
const matchCacheSeconds = 60 * 60 * 24 * 30;

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/shared-matches') {
      return handleSharedMatches(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleSharedMatches(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method not allowed.' }, 405);
  }

  if (!env.RIOT_API_KEY) {
    return jsonResponse({ message: 'RIOT_API_KEY is not configured in Cloudflare secrets.' }, 500);
  }

  let input;

  try {
    input = validateInput(await request.json());
  } catch (error) {
    return jsonResponse({ message: error.message }, 400);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        const client = createRiotClient(input.region, env.RIOT_API_KEY, send);
        const [firstAccount, secondAccount] = await Promise.all([
          client.account(input.first),
          client.account(input.second)
        ]);

        const matches = await findSharedMatches(client, firstAccount.puuid, secondAccount.puuid, send);
        send({ type: 'done', count: matches.length });
      } catch (error) {
        send({ type: 'error', message: error.message || 'Something went wrong while checking match history.' });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/x-ndjson; charset=utf-8'
    }
  });
}

function validateInput(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('Request body must be JSON.');
  }

  if (!regions.has(input.region)) {
    throw new Error('Choose a valid routing region.');
  }

  return {
    first: validateRiotId(input.first),
    second: validateRiotId(input.second),
    region: input.region
  };
}

function validateRiotId(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('Use Riot ID format GameName#TAG for both players.');
  }

  const gameName = String(value.gameName || '').trim();
  const tagLine = String(value.tagLine || '').trim();

  if (!gameName || !tagLine) {
    throw new Error('Use Riot ID format GameName#TAG for both players.');
  }

  return { gameName, tagLine };
}

function createRiotClient(region, apiKey, send) {
  let nextRequestAt = 0;
  let requestQueue = Promise.resolve();

  const request = async (path) => {
    const response = await fetchWithRetry(`https://${region}.api.riotgames.com${path}`, {
      headers: {
        'X-Riot-Token': apiKey
      }
    });

    if (!response.ok) {
      const detail = await safeJson(response);
      const status = detail?.status?.message || response.statusText;

      if (response.status === 401 && status.toLowerCase().includes('apikey')) {
        throw new Error('Riot did not accept the configured API key. Add a fresh RIOT_API_KEY secret in Cloudflare.');
      }

      throw new Error(`Riot API returned ${response.status}: ${status}`);
    }

    return response.json();
  };

  const fetchWithRetry = async (url, options) => {
    while (true) {
      await reserveRequestSlot();
      const response = await fetch(url, options);

      if (response.status !== 429) {
        return response;
      }

      const retryAfter = getRetryAfterSeconds(response);
      send({
        type: 'message',
        message: `Riot rate limit reached. Waiting ${retryAfter} second${retryAfter === 1 ? '' : 's'} before continuing.`
      });
      nextRequestAt = Date.now() + (retryAfter * 1000);
      await sleep(retryAfter * 1000);
    }
  };

  const reserveRequestSlot = () => {
    requestQueue = requestQueue.then(waitForRequestSlot, waitForRequestSlot);
    return requestQueue;
  };

  const waitForRequestSlot = async () => {
    const waitMs = nextRequestAt - Date.now();

    if (waitMs > 0) {
      await sleep(waitMs);
    }

    nextRequestAt = Math.max(Date.now(), nextRequestAt) + requestDelayMs;
  };

  return {
    account: ({ gameName, tagLine }) => request(`/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`),
    matchIds: (puuid, start) => request(`/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?start=${start}&count=${batchSize}`),
    match: async (matchId) => {
      const cached = await readCachedMatch(region, matchId);

      if (cached) {
        return cached;
      }

      const match = normalizeMatch(await request(`/lol/match/v5/matches/${encodeURIComponent(matchId)}`));
      await writeCachedMatch(region, match);
      return match;
    }
  };
}

async function findSharedMatches(client, firstPuuid, secondPuuid, send) {
  const [firstIds, secondIds] = await getAvailableMatchIds(client, firstPuuid, secondPuuid, send);
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
    send,
    label: 'Loading confirmed shared match'
  });

  await loadSharedMatches({
    client,
    matchIds: oneSidedIds,
    matches,
    foundIds,
    firstPuuid,
    secondPuuid,
    send,
    label: 'Verifying possible shared match'
  });

  return matches;
}

async function loadSharedMatches({ client, matchIds, matches, foundIds, firstPuuid, secondPuuid, send, label }) {
  for (const [index, matchId] of matchIds.entries()) {
    send({
      type: 'message',
      message: `${label} ${index + 1} of ${matchIds.length}. Found ${matches.length} shared.`
    });
    const match = await client.match(matchId);

    if (hasParticipants(match, firstPuuid, secondPuuid) && !foundIds.has(match.metadata.matchId)) {
      foundIds.add(match.metadata.matchId);
      const formatted = formatMatch(match, firstPuuid, secondPuuid);
      matches.push(formatted);
      send({ type: 'match', match: formatted });
    }
  }
}

async function getAvailableMatchIds(client, firstPuuid, secondPuuid, send) {
  const firstIds = [];
  const secondIds = [];
  let start = 0;
  let firstDone = false;
  let secondDone = false;

  while (!firstDone || !secondDone) {
    send({
      type: 'message',
      message: `Scanning games ${start + 1}-${start + batchSize}.`
    });

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

function formatMatch(match, firstPuuid, secondPuuid) {
  const first = match.info.participants.find((participant) => participant.puuid === firstPuuid);
  const second = match.info.participants.find((participant) => participant.puuid === secondPuuid);

  return {
    id: match.metadata.matchId,
    queueId: match.info.queueId,
    queue: queueNames.get(match.info.queueId) || `Queue ${match.info.queueId}`,
    startedAt: new Date(match.info.gameCreation).toISOString(),
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

async function readCachedMatch(region, matchId) {
  const response = await caches.default.match(getMatchCacheRequest(region, matchId));

  if (!response) {
    return null;
  }

  return response.json();
}

async function writeCachedMatch(region, match) {
  const response = new Response(JSON.stringify(match), {
    headers: {
      'Cache-Control': `public, max-age=${matchCacheSeconds}`,
      'Content-Type': 'application/json'
    }
  });

  await caches.default.put(getMatchCacheRequest(region, match.metadata.matchId), response);
}

function getMatchCacheRequest(region, matchId) {
  return new Request(`https://duotrace-cache.local/matches/${encodeURIComponent(region)}/${encodeURIComponent(matchId)}`);
}

function getRetryAfterSeconds(response) {
  const retryAfter = Number(response.headers.get('retry-after'));

  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.ceil(retryAfter);
  }

  return fallbackRateLimitSeconds;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
