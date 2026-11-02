import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRiotId } from '../src/utils/riotId.js';

test('parseRiotId accepts valid Riot IDs', () => {
  assert.deepEqual(parseRiotId('TestUser#NA1'), {
    gameName: 'TestUser',
    tagLine: 'NA1'
  });
});

test('parseRiotId rejects missing tag', () => {
  assert.throws(() => parseRiotId('TestUser'), /GameName#TAG/);
});

test('parseRiotId rejects empty values', () => {
  assert.throws(() => parseRiotId('#'), /GameName#TAG/);
});
