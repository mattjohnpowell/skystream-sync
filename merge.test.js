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

test('history deletion tombstones drop stale watches and revive on newer watch', () => {
  const afterDelete = mergeProfiles(
    JSON.stringify({
      history: [
        { key: 'show', entry: { timestamp: 100, position: 50 } },
        { key: 'other', entry: { timestamp: 100, position: 10 } },
      ],
    }),
    {
      replaceHistory: true,
      updatedAt: 200,
      history: [{ key: 'other', entry: { timestamp: 100, position: 10 } }],
      deletedHistoryTimestamps: { show: 200 },
    },
  );

  assert.deepEqual(
    afterDelete.history.map((h) => h.key),
    ['other'],
  );
  assert.equal(afterDelete.deletedHistoryTimestamps.show, 200);

  // Stale watch from offline device (timestamp 150 <= 200) stays deleted.
  const staleResync = mergeProfiles(JSON.stringify(afterDelete), {
    history: [{ key: 'show', entry: { timestamp: 150, position: 99 } }],
  });
  assert.deepEqual(
    staleResync.history.map((h) => h.key),
    ['other'],
  );

  // Newer watch (timestamp 300 > 200) revives the entry and clears tombstone.
  const revived = mergeProfiles(JSON.stringify(staleResync), {
    history: [{ key: 'show', entry: { timestamp: 300, position: 120 } }],
  });
  assert.equal(revived.history.length, 2);
  assert.equal(revived.deletedHistoryTimestamps?.show, undefined);
});

test('library replacement, deletedLibraryUrls, and settings metadata persist cleanly', () => {
  const initial = mergeProfiles('{}', {
    library: [
      { url: 'https://a', title: 'A' },
      { url: 'https://b', title: 'B' },
    ],
    nuvioRepos: ['https://nuvio.repo/manifest.json'],
    stremioAddons: ['https://stremio.addon/manifest.json'],
    activeProviderId: 'com.provider.a',
    nuvioRepoSettings: {
      'https://nuvio.repo/manifest.json': { disabled: ['s1'], enabled: ['s2'] },
    },
    stremioAddonStates: {
      'https://stremio.addon/manifest.json': false,
    },
    skystreamPlugins: [
      { packageName: 'com.provider', url: 'https://p.sky' },
      { packageName: '__skystream_sync_meta__', activeProviderId: 'com.provider.a' },
    ],
  });

  assert.equal(initial.skystreamPlugins.length, 1);
  assert.equal(initial.activeProviderId, 'com.provider.a');
  assert.deepEqual(initial.nuvioRepoSettings['https://nuvio.repo/manifest.json'], {
    disabled: ['s1'],
    enabled: ['s2'],
  });
  assert.equal(initial.stremioAddonStates['https://stremio.addon/manifest.json'], false);

  const removed = mergeProfiles(JSON.stringify(initial), {
    replaceLibrary: true,
    library: [{ url: 'https://a', title: 'A' }],
    deletedLibraryUrls: ['https://b'],
    nuvioRepos: ['https://nuvio.repo/manifest.json'],
    stremioAddons: ['https://stremio.addon/manifest.json'],
  });

  assert.deepEqual(
    removed.library.map((i) => i.url),
    ['https://a'],
  );
  assert.deepEqual(removed.deletedLibraryUrls, ['https://b']);
});
