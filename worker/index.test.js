import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeMatch, validateRiotId, validateStart } from './index.js';

test('accepts a complete Riot ID', () => {
  assert.deepEqual(validateRiotId({ gameName: '  Wrenchfry ', tagLine: ' ZA1 ' }), {
    gameName: 'Wrenchfry',
    tagLine: 'ZA1'
  });
});

test('rejects incomplete Riot IDs and invalid history offsets', () => {
  assert.throws(() => validateRiotId({ gameName: 'Wrenchfry' }), (error) => error instanceof Response && error.status === 400);
  assert.throws(() => validateStart(-1), (error) => error instanceof Response && error.status === 400);
});

test('normalizes a Riot match response to the data used by the client', () => {
  const match = normalizeMatch({
    metadata: {
      matchId: 'NA1_123',
      participants: ['first-puuid', 'second-puuid']
    },
    info: {
      queueId: 420,
      gameCreation: 1_700_000_000_000,
      gameDuration: 1500,
      gameMode: 'CLASSIC',
      participants: [{
        puuid: 'first-puuid',
        riotIdGameName: 'First',
        riotIdTagline: 'NA1',
        summonerName: 'First',
        championName: 'Ahri',
        teamId: 100,
        win: true,
        kills: 8,
        deaths: 2,
        assists: 10,
        unnecessaryRiotField: 'not exposed'
      }]
    }
  });

  assert.equal(match.metadata.matchId, 'NA1_123');
  assert.equal(match.info.participants[0].championName, 'Ahri');
  assert.equal('unnecessaryRiotField' in match.info.participants[0], false);
});
