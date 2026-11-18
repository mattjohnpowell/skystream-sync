const META_PACKAGE_NAME = '__skystream_sync_meta__';

function tryParseJson(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function extractMeta(profile) {
  const plugins = Array.isArray(profile?.skystreamPlugins)
    ? profile.skystreamPlugins
    : [];
  const metaEntry = plugins.find((p) => p?.packageName === META_PACKAGE_NAME);
  const cleanPlugins = plugins.filter((p) => p?.packageName !== META_PACKAGE_NAME);

  const deletedHistoryTimestamps = {
    ...(tryParseJson(metaEntry?.deletedHistoryTimestamps) || {}),
    ...(profile?.deletedHistoryTimestamps &&
    typeof profile.deletedHistoryTimestamps === 'object'
      ? profile.deletedHistoryTimestamps
      : {}),
  };
  const deletedHistoryKeys = Array.isArray(profile?.deletedHistoryKeys)
    ? profile.deletedHistoryKeys
    : Array.isArray(tryParseJson(metaEntry?.deletedHistoryKeys))
      ? tryParseJson(metaEntry?.deletedHistoryKeys)
      : [];
  const fallbackTs = Number(profile?.updatedAt) || 0;
  for (const key of deletedHistoryKeys) {
    if (typeof key === 'string' && key && deletedHistoryTimestamps[key] == null) {
      deletedHistoryTimestamps[key] = fallbackTs;
    }
  }

  const deletedLibraryUrls = Array.isArray(profile?.deletedLibraryUrls)
    ? profile.deletedLibraryUrls
    : Array.isArray(tryParseJson(metaEntry?.deletedLibraryUrls))
      ? tryParseJson(metaEntry?.deletedLibraryUrls)
      : [];

  const activeProviderId =
    profile?.activeProviderId !== undefined
      ? profile.activeProviderId
      : metaEntry?.activeProviderId;

  const nuvioRepoSettings =
    profile?.nuvioRepoSettings && typeof profile.nuvioRepoSettings === 'object'
      ? profile.nuvioRepoSettings
      : tryParseJson(metaEntry?.nuvioRepoSettings);

  const stremioAddonStates =
    profile?.stremioAddonStates && typeof profile.stremioAddonStates === 'object'
      ? profile.stremioAddonStates
      : tryParseJson(metaEntry?.stremioAddonStates);

  return {
    cleanPlugins,
    deletedHistoryTimestamps,
    deletedLibraryUrls,
    activeProviderId,
    nuvioRepoSettings,
    stremioAddonStates,
  };
}

/**
 * Merges a device's profile into the stored one.
 *
 * History is per key (movie/series url, and `EP_` episode keys). The newer
 * `entry.timestamp` wins unless deleted via `deletedHistoryTimestamps` or
 * omitted with `replaceHistory: true`. Episode checkmarks are a union, and a
 * key present on the incoming profile replaces the stored value. Library items
 * union by url unless `replaceLibrary` is true or listed in `deletedLibraryUrls`.
 * Extension lists union unless `replaceExtensions` is true, in which case the
 * incoming device's lists replace the stored ones.
 */
export function mergeProfiles(existingRaw, incoming) {
  let existing = {};
  try {
    existing = JSON.parse(existingRaw || '{}');
  } catch (_) {
    existing = {};
  }
  if (existing == null || typeof existing !== 'object') existing = {};
  const next = incoming && typeof incoming === 'object' ? incoming : {};

  const existingMeta = extractMeta(existing);
  const nextMeta = extractMeta(next);

  const deletedHistoryTimestamps = { ...existingMeta.deletedHistoryTimestamps };
  for (const [key, ts] of Object.entries(nextMeta.deletedHistoryTimestamps)) {
    const num = Number(ts) || 0;
    if (num > (Number(deletedHistoryTimestamps[key]) || 0)) {
      deletedHistoryTimestamps[key] = num;
    }
  }

  const historyMap = new Map();
  if (next.replaceHistory === true) {
    for (const item of next.history || []) {
      if (item?.key && item?.entry) historyMap.set(item.key, item);
    }
    const nextUpdatedAt = Number(next.updatedAt) || 0;
    for (const item of existing.history || []) {
      if (!item?.key || !item?.entry) continue;
      if (deletedHistoryTimestamps[item.key] != null) continue;
      const prevTs = Number(item.entry.timestamp) || 0;
      if (prevTs > nextUpdatedAt && !historyMap.has(item.key)) {
        historyMap.set(item.key, item);
      }
    }
  } else {
    for (const item of existing.history || []) {
      if (item?.key && item?.entry) historyMap.set(item.key, item);
    }
    for (const item of next.history || []) {
      if (!item?.key || !item?.entry) continue;
      const prev = historyMap.get(item.key);
      const prevTs = Number(prev?.entry?.timestamp) || 0;
      const nextTs = Number(item.entry.timestamp) || 0;
      if (!prev || nextTs >= prevTs) historyMap.set(item.key, item);
    }
  }

  for (const [key, item] of historyMap.entries()) {
    const delTs = deletedHistoryTimestamps[key];
    if (delTs == null) continue;
    const itemTs = Number(item?.entry?.timestamp) || 0;
    if (itemTs <= Number(delTs)) {
      historyMap.delete(key);
    } else {
      delete deletedHistoryTimestamps[key];
    }
  }

  const episodeOverrides = {
    ...(existing.episodeOverrides || {}),
    ...(next.episodeOverrides || {}),
  };

  const deletedLibrarySet = new Set([
    ...existingMeta.deletedLibraryUrls,
    ...nextMeta.deletedLibraryUrls,
  ]);
  const existingLibUrls = new Set(
    (existing.library || []).map((b) => b?.url).filter(Boolean),
  );
  const libraryMap = new Map();
  if (next.replaceLibrary === true) {
    for (const bookmark of next.library || []) {
      if (bookmark?.url) {
        libraryMap.set(bookmark.url, bookmark);
        deletedLibrarySet.delete(bookmark.url);
      }
    }
  } else {
    for (const bookmark of existing.library || []) {
      if (bookmark?.url && !deletedLibrarySet.has(bookmark.url)) {
        libraryMap.set(bookmark.url, bookmark);
      }
    }
    for (const bookmark of next.library || []) {
      if (!bookmark?.url) continue;
      const newlyAddedByIncoming = !existingLibUrls.has(bookmark.url);
      if (newlyAddedByIncoming) deletedLibrarySet.delete(bookmark.url);
      if (!deletedLibrarySet.has(bookmark.url)) {
        libraryMap.set(bookmark.url, bookmark);
      }
    }
  }

  const replaceExt = next.replaceExtensions === true;
  const unionStrings = (a = [], b = []) =>
    replaceExt ? b : Array.from(new Set([...(a || []), ...(b || [])]));
  const unionByKey = (a = [], b = [], keyFn) => {
    if (replaceExt) return b || [];
    const map = new Map();
    for (const item of [...(a || []), ...(b || [])]) {
      const key = item && keyFn(item);
      if (key) map.set(key, item);
    }
    return Array.from(map.values());
  };

  const mergedNuvioRepos = unionStrings(existing.nuvioRepos, next.nuvioRepos);
  const mergedStremioAddons = unionStrings(
    existing.stremioAddons,
    next.stremioAddons,
  );

  const rawNuvioSettings = nextMeta.nuvioRepoSettings
    ? nextMeta.nuvioRepoSettings
    : { ...(existingMeta.nuvioRepoSettings || {}) };
  const nuvioRepoSettings = {};
  for (const url of mergedNuvioRepos) {
    if (rawNuvioSettings && rawNuvioSettings[url]) {
      nuvioRepoSettings[url] = rawNuvioSettings[url];
    }
  }

  const rawStremioStates = nextMeta.stremioAddonStates
    ? nextMeta.stremioAddonStates
    : { ...(existingMeta.stremioAddonStates || {}) };
  const stremioAddonStates = {};
  for (const url of mergedStremioAddons) {
    if (rawStremioStates && rawStremioStates[url] !== undefined) {
      stremioAddonStates[url] = rawStremioStates[url] === true;
    }
  }

  const activeProviderId =
    nextMeta.activeProviderId !== undefined
      ? nextMeta.activeProviderId
      : existingMeta.activeProviderId;

  const deletedHistoryKeys = Object.keys(deletedHistoryTimestamps);
  const deletedLibraryUrls = Array.from(deletedLibrarySet).sort();

  return {
    version: 1,
    updatedAt: Date.now(),
    history: Array.from(historyMap.values()),
    episodeOverrides,
    library: Array.from(libraryMap.values()),
    skystreamRepos: unionStrings(existing.skystreamRepos, next.skystreamRepos),
    skystreamPlugins: unionByKey(
      existingMeta.cleanPlugins,
      nextMeta.cleanPlugins,
      (plugin) => plugin.packageName,
    ),
    cloudstreamRepos: unionStrings(
      existing.cloudstreamRepos,
      next.cloudstreamRepos,
    ),
    cloudstreamPlugins: unionByKey(
      existing.cloudstreamPlugins,
      next.cloudstreamPlugins,
      (plugin) => `${plugin.repositoryUrl || ''}::${plugin.internalName || ''}`,
    ),
    nuvioRepos: mergedNuvioRepos,
    stremioAddons: mergedStremioAddons,
    ...(activeProviderId ? { activeProviderId } : {}),
    ...(Object.keys(nuvioRepoSettings).length > 0
      ? { nuvioRepoSettings }
      : {}),
    ...(Object.keys(stremioAddonStates).length > 0
      ? { stremioAddonStates }
      : {}),
    ...(deletedHistoryKeys.length > 0 ? { deletedHistoryKeys } : {}),
    ...(deletedHistoryKeys.length > 0 ? { deletedHistoryTimestamps } : {}),
    ...(deletedLibraryUrls.length > 0 ? { deletedLibraryUrls } : {}),
  };
}
