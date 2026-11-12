import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeProfiles } from './merge.js';

test('history keeps the newer timestamp per key, including episode keys', () => {
  const merged = mergeProfiles(
    JSON.stringify({
      history: [
        { key: 'show', entry: { timestamp: 10, position: 1 } },
        { key: 'EP_ep1', entry: { timestamp: 50, position: 9 } },
      ],
    }),
    {
      history: [
        { key: 'show', entry: { timestamp: 20, position: 5 } },
        { key: 'EP_ep1', entry: { timestamp: 40, position: 1 } },
        { key: 'movie', entry: { timestamp: 3, position: 2 } },
      ],
    },
  );

  const byKey = Object.fromEntries(merged.history.map((item) => [item.key, item.entry]));
  assert.equal(byKey.show.position, 5);
  assert.equal(byKey.EP_ep1.position, 9);
  assert.equal(byKey.movie.position, 2);
});

test('extension lists union by identity and replace when asked', () => {
  const unioned = mergeProfiles(
    JSON.stringify({
      skystreamPlugins: [{ packageName: 'com.a', repositoryUrl: 'https://old' }],
      stremioAddons: ['https://addon.one/manifest.json'],
    }),
    {
      skystreamPlugins: [
        { packageName: 'com.a', repositoryUrl: 'https://new' },
        { packageName: 'com.b', repositoryUrl: 'https://b' },
      ],
      stremioAddons: ['https://addon.one/manifest.json', 'https://addon.two/manifest.json'],
    },
  );
  assert.deepEqual(
    unioned.skystreamPlugins.map((plugin) => plugin.repositoryUrl),
    ['https://new', 'https://b'],
  );
  assert.equal(unioned.stremioAddons.length, 2);

  const replaced = mergeProfiles(JSON.stringify(unioned), {
    replaceExtensions: true,
    skystreamPlugins: [{ packageName: 'com.c', repositoryUrl: 'https://c' }],
    stremioAddons: [],
    skystreamRepos: [],
    cloudstreamRepos: [],
    cloudstreamPlugins: [],
    nuvioRepos: [],
  });
  assert.deepEqual(replaced.skystreamPlugins, [
    { packageName: 'com.c', repositoryUrl: 'https://c' },
  ]);
  assert.deepEqual(replaced.stremioAddons, []);
});
