/**
 * Merges a device's profile into the stored one.
 *
 * History is per key (movie/series url, and `EP_` episode keys). The newer
 * `entry.timestamp` wins. Episode checkmarks are a union, and a key present
 * on the incoming profile replaces the stored value. Library items union by
 * url. Extension lists union unless `replaceExtensions` is true, in which
 * case the incoming device's lists replace the stored ones.
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

  const historyMap = new Map();
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

  const episodeOverrides = {
    ...(existing.episodeOverrides || {}),
    ...(next.episodeOverrides || {}),
  };

  const libraryMap = new Map();
  for (const bookmark of existing.library || []) {
    if (bookmark?.url) libraryMap.set(bookmark.url, bookmark);
  }
  for (const bookmark of next.library || []) {
    if (bookmark?.url) libraryMap.set(bookmark.url, bookmark);
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

  return {
    version: 1,
    updatedAt: Date.now(),
    history: Array.from(historyMap.values()),
    episodeOverrides,
    library: Array.from(libraryMap.values()),
    skystreamRepos: unionStrings(existing.skystreamRepos, next.skystreamRepos),
    skystreamPlugins: unionByKey(
      existing.skystreamPlugins,
      next.skystreamPlugins,
      (plugin) => plugin.packageName,
    ),
    cloudstreamRepos: unionStrings(existing.cloudstreamRepos, next.cloudstreamRepos),
    cloudstreamPlugins: unionByKey(
      existing.cloudstreamPlugins,
      next.cloudstreamPlugins,
      (plugin) => `${plugin.repositoryUrl || ''}::${plugin.internalName || ''}`,
    ),
    nuvioRepos: unionStrings(existing.nuvioRepos, next.nuvioRepos),
    stremioAddons: unionStrings(existing.stremioAddons, next.stremioAddons),
  };
}
