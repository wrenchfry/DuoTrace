const regions = new Set(['americas', 'europe', 'asia', 'sea']);
const batchSize = 100;
const matchCacheSeconds = 60 * 60 * 24 * 30;

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname === '/api/analytics/searches') {
        return await handleAnalyticsSearch(request, env);
      }

      if (url.pathname === '/api/analytics/export') {
        return await handleAnalyticsExport(request, env, url);
      }

      if (url.pathname === '/api/account') {
        return await handleAccount(request, env);
      }

      if (url.pathname === '/api/match-ids') {
        return await handleMatchIds(request, env);
      }

      if (url.pathname === '/api/match') {
        return await handleMatch(request, env);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof Response) {
        return error;
      }

      return jsonResponse({ message: 'Something went wrong while checking match history.' }, 500);
    }
  }
};

async function handleAccount(request, env) {
  const input = await readRequest(request, env);
  const account = validateRiotId(input.account);
  const data = await riotRequest(
    input.region,
    `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(account.gameName)}/${encodeURIComponent(account.tagLine)}`,
    env.RIOT_API_KEY
  );

  return jsonResponse(data);
}

async function handleMatchIds(request, env) {
  const input = await readRequest(request, env);
  const puuid = validateString(input.puuid, 'Missing player identifier.');
  const start = validateStart(input.start);
  const data = await riotRequest(
    input.region,
    `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?start=${start}&count=${batchSize}`,
    env.RIOT_API_KEY
  );

  return jsonResponse(data);
}

async function handleMatch(request, env) {
  const input = await readRequest(request, env);
  const matchId = validateString(input.matchId, 'Missing match ID.');
  const cached = await readCachedMatch(input.region, matchId);

  if (cached) {
    return jsonResponse(cached);
  }

  const match = normalizeMatch(await riotRequest(
    input.region,
    `/lol/match/v5/matches/${encodeURIComponent(matchId)}`,
    env.RIOT_API_KEY
  ));
  await writeCachedMatch(input.region, match);

  return jsonResponse(match);
}

async function handleAnalyticsSearch(request, env) {
  if (request.method !== 'POST') {
    throw new Response(JSON.stringify({ message: 'Method not allowed.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const input = await readJsonRequest(request);
  const first = validateRiotId(input.first);
  const second = validateRiotId(input.second);

  if (!regions.has(input.region)) {
    throw new Response(JSON.stringify({ message: 'Choose a valid routing region.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!Array.isArray(input.matches)) {
    throw new Response(JSON.stringify({ message: 'Search matches must be an array.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!env.ANALYTICS_DB) {
    return jsonResponse({ recorded: false }, 202);
  }

  const searchId = crypto.randomUUID();
  const searchedAt = new Date().toISOString();

  await env.ANALYTICS_DB.prepare(`
    INSERT INTO analytics_searches (
      search_id,
      first_game_name,
      first_tag_line,
      second_game_name,
      second_tag_line,
      region,
      searched_at,
      shared_match_count,
      matches_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    searchId,
    first.gameName,
    first.tagLine,
    second.gameName,
    second.tagLine,
    input.region,
    searchedAt,
    input.matches.length,
    JSON.stringify(input.matches)
  ).run();

  return jsonResponse({ recorded: true, searchId }, 202);
}

async function handleAnalyticsExport(request, env, url) {
  if (request.method !== 'GET') {
    throw new Response(JSON.stringify({ message: 'Method not allowed.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!env.ANALYTICS_DB || !env.ANALYTICS_EXPORT_TOKEN) {
    throw new Response(JSON.stringify({ message: 'Analytics export is not configured.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const token = request.headers.get('Authorization');
  if (token !== `Bearer ${env.ANALYTICS_EXPORT_TOKEN}`) {
    throw new Response(JSON.stringify({ message: 'Unauthorized.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const cursor = validateCursor(url.searchParams.get('after'));
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500);
  const result = await env.ANALYTICS_DB.prepare(`
    SELECT sequence, search_id, first_game_name, first_tag_line, second_game_name, second_tag_line,
      region, searched_at, shared_match_count, matches_json
    FROM analytics_searches
    WHERE sequence > ?
    ORDER BY sequence ASC
    LIMIT ?
  `).bind(cursor, limit + 1).all();
  const rows = result.results || [];
  const hasMore = rows.length > limit;
  const records = rows.slice(0, limit).map((row) => ({
    sequence: row.sequence,
    searchId: row.search_id,
    first: { gameName: row.first_game_name, tagLine: row.first_tag_line },
    second: { gameName: row.second_game_name, tagLine: row.second_tag_line },
    region: row.region,
    searchedAt: row.searched_at,
    sharedMatchCount: row.shared_match_count,
    matches: JSON.parse(row.matches_json)
  }));

  return jsonResponse({
    records,
    nextCursor: records.length ? records[records.length - 1].sequence : cursor,
    hasMore
  });
}

async function readRequest(request, env) {
  if (request.method !== 'POST') {
    throw new Response(JSON.stringify({ message: 'Method not allowed.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!env.RIOT_API_KEY) {
    throw new Response(JSON.stringify({ message: 'RIOT_API_KEY is not configured in Cloudflare secrets.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const input = await readJsonRequest(request);

  if (!regions.has(input.region)) {
    throw new Response(JSON.stringify({ message: 'Choose a valid routing region.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return input;
}

async function readJsonRequest(request) {
  try {
    return await request.json();
  } catch {
    throw new Response(JSON.stringify({ message: 'Request body must be JSON.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function riotRequest(region, path, apiKey) {
  const response = await fetch(`https://${region}.api.riotgames.com${path}`, {
    headers: {
      'X-Riot-Token': apiKey
    }
  });

  if (!response.ok) {
    const detail = await safeJson(response);
    const status = detail?.status?.message || response.statusText;

    if (response.status === 429) {
      return rateLimitResponse(response);
    }

    if (response.status === 401 && status.toLowerCase().includes('apikey')) {
      throw new Response(JSON.stringify({
        message: 'Riot did not accept the configured API key. Add a fresh RIOT_API_KEY secret in Cloudflare.'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    throw new Response(JSON.stringify({ message: `Riot API returned ${response.status}: ${status}` }), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return response.json();
}

function rateLimitResponse(response) {
  const retryAfter = Number(response.headers.get('retry-after'));
  throw new Response(JSON.stringify({
    message: 'Riot rate limit reached.',
    retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 120
  }), {
    status: 429,
    headers: { 'Content-Type': 'application/json' }
  });
}

function validateRiotId(value) {
  if (!value || typeof value !== 'object') {
    throw new Response(JSON.stringify({ message: 'Use Riot ID format GameName#TAG for both players.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const gameName = String(value.gameName || '').trim();
  const tagLine = String(value.tagLine || '').trim();

  if (!gameName || !tagLine) {
    throw new Response(JSON.stringify({ message: 'Use Riot ID format GameName#TAG for both players.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return { gameName, tagLine };
}

function validateString(value, message) {
  const normalized = String(value || '').trim();

  if (!normalized) {
    throw new Response(JSON.stringify({ message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return normalized;
}

function validateStart(value) {
  const start = Number(value);

  if (!Number.isInteger(start) || start < 0) {
    throw new Response(JSON.stringify({ message: 'Invalid match page start.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return start;
}

function validateCursor(value) {
  const cursor = Number(value || 0);

  if (!Number.isInteger(cursor) || cursor < 0) {
    throw new Response(JSON.stringify({ message: 'Invalid analytics cursor.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return cursor;
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

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json'
    }
  });
}
