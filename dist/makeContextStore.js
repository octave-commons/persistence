const DEFAULT_ASSISTANT_NAME = 'Pantheon';
const DEFAULT_RECENT_LIMIT = 10;
const DEFAULT_QUERY_LIMIT = 5;
const DEFAULT_RESULT_LIMIT = 20;
const DEFAULT_FORMAT_TIME = (ms) => new Date(ms).toISOString();
export const makeContextStore = (deps) => {
    const assistantName = deps.assistantName ?? DEFAULT_ASSISTANT_NAME;
    const providedResolveDisplayName = deps.resolveDisplayName ?? deps.resolveName;
    const formatTime = deps.formatTime ?? DEFAULT_FORMAT_TIME;
    const compileContext = async (options) => {
        const adapters = toCollectionAdapters(await Promise.resolve(deps.getCollections()));
        if (!adapters.length) {
            return [];
        }
        const normalised = normaliseCompileOptions(options);
        const latestEntries = await collectLatestEntries(adapters, normalised.recentLimit);
        const querySeeds = buildQuerySeeds(normalised.texts, latestEntries, normalised.queryLimit);
        const relatedEntries = querySeeds.length
            ? await collectRelatedEntries(adapters, querySeeds, normalised.limit)
            : [];
        const relatedImages = querySeeds.length
            ? await collectRelatedEntries(adapters, querySeeds, normalised.limit, { type: 'image' })
            : [];
        const preparedEntries = prepareEntries(relatedEntries, latestEntries, relatedImages);
        const filteredEntries = filterValidEntries(preparedEntries);
        const dedupedEntries = dedupeByText(filteredEntries);
        const sortedEntries = sortByTimestamp(dedupedEntries);
        const limitedEntries = limitByCollectionCount(sortedEntries, normalised.limit, adapters.length);
        return limitedEntries.map((entry) => toContextMessage(entry, {
            assistantName,
            formatTime,
            resolveRole: deps.resolveRole,
            resolveDisplayName: providedResolveDisplayName,
        }));
    };
    return { compileContext };
};
const normaliseCompileOptions = (options) => {
    const texts = Array.isArray(options?.texts) ? options.texts.filter(isNonEmptyString) : [];
    return {
        texts,
        recentLimit: normalisePositiveNumber(options?.recentLimit, DEFAULT_RECENT_LIMIT),
        queryLimit: normalisePositiveNumber(options?.queryLimit, DEFAULT_QUERY_LIMIT),
        limit: normalisePositiveNumber(options?.limit, DEFAULT_RESULT_LIMIT),
    };
};
const normalisePositiveNumber = (value, fallback) => {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    return fallback;
};
const toCollectionAdapters = (collections) => collections.reduce((acc, candidate) => {
    if (candidate &&
        typeof candidate === 'object' &&
        typeof candidate.getMostRecent === 'function' &&
        typeof candidate.getMostRelevant === 'function') {
        acc.push(candidate);
    }
    return acc;
}, []);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const collectLatestEntries = async (adapters, limit) => {
    if (!adapters.length || limit <= 0) {
        return [];
    }
    const batches = await Promise.all(adapters.map((adapter) => safeGetMostRecent(adapter, limit)));
    return batches.flat();
};
const safeGetMostRecent = async (adapter, limit) => {
    try {
        return await adapter.getMostRecent(limit);
    }
    catch (error) {
        console.warn(`makeContextStore failed to read recent entries from ${adapter.name ?? 'unknown'} collection`, error);
        return [];
    }
};
const collectRelatedEntries = async (adapters, queries, limit, where) => {
    if (!adapters.length || limit <= 0 || queries.length === 0) {
        return [];
    }
    const batches = await Promise.all(adapters.map((adapter) => safeGetMostRelevant(adapter, queries, limit, where)));
    return batches.flat();
};
const safeGetMostRelevant = async (adapter, queries, limit, where) => {
    try {
        return await adapter.getMostRelevant([...queries], limit, where);
    }
    catch (error) {
        console.warn(`makeContextStore failed to read related entries from ${adapter.name ?? 'unknown'} collection`, error);
        return [];
    }
};
const buildQuerySeeds = (texts, latestEntries, queryLimit) => {
    if (queryLimit <= 0) {
        return [];
    }
    const combined = [...texts];
    for (const entry of latestEntries) {
        if (isNonEmptyString(entry.text)) {
            combined.push(entry.text);
        }
    }
    return combined.slice(-queryLimit);
};
const prepareEntries = (related, latest, images) => {
    const relatedWithoutImages = related.filter((entry) => getMetadataType(entry.metadata) !== 'image');
    return [...relatedWithoutImages, ...latest, ...images];
};
const filterValidEntries = (entries) => entries.filter((entry) => {
    if (!entry) {
        return false;
    }
    if (!isNonEmptyString(entry.text)) {
        return false;
    }
    if (typeof entry.metadata !== 'object' || entry.metadata === null) {
        return false;
    }
    return true;
});
const dedupeByText = (entries) => {
    const seen = new Set();
    const deduped = [];
    for (const entry of entries) {
        const text = entry.text;
        if (!isNonEmptyString(text)) {
            continue;
        }
        if (seen.has(text)) {
            continue;
        }
        seen.add(text);
        deduped.push(entry);
    }
    return deduped;
};
const sortByTimestamp = (entries) => [...entries].sort((a, b) => toEpochMilliseconds(a.timestamp) - toEpochMilliseconds(b.timestamp));
const limitByCollectionCount = (entries, limit, collectionCount) => {
    if (limit <= 0) {
        return [];
    }
    const multiplicativeFactor = Math.max(collectionCount, 1) * 2;
    const maxResults = limit * multiplicativeFactor;
    return entries.length > maxResults ? entries.slice(-maxResults) : [...entries];
};
const toContextMessage = (entry, deps) => {
    const metadata = (entry.metadata ?? {});
    const displayName = resolveDisplayNameForEntry(metadata, deps);
    const isAssistant = displayName === deps.assistantName;
    const baseRole = resolveBaseRole(metadata, isAssistant);
    const role = safeResolveRole(deps.resolveRole, metadata, baseRole);
    if (getMetadataType(metadata) === 'image') {
        const caption = getString(metadata.caption) ?? `${displayName ?? 'Unknown'} shared an image`;
        return {
            role,
            content: caption,
            images: [entry.text],
        };
    }
    const timestamp = toEpochMilliseconds(entry.timestamp);
    const formattedTime = deps.formatTime(timestamp);
    const verb = metadata.isThought ? 'thought' : 'said';
    const shouldFormatAssistant = !(isAssistant && !metadata.isThought);
    const content = shouldFormatAssistant
        ? `${displayName ?? 'Unknown'} ${verb} (${formattedTime}): ${entry.text}`
        : entry.text;
    return {
        role,
        content,
    };
};
const resolveBaseRole = (metadata, isAssistant) => {
    if (isRole(metadata.role)) {
        return metadata.role;
    }
    if (isAssistant) {
        return metadata.isThought ? 'system' : 'assistant';
    }
    return 'user';
};
const getMetadataType = (metadata) => {
    const type = metadata?.type;
    return typeof type === 'string' ? type.toLowerCase() : undefined;
};
const resolveDisplayNameForEntry = (metadata, deps) => {
    const resolved = safeResolveName(deps.resolveDisplayName, metadata);
    if (isNonEmptyString(resolved)) {
        return resolved.trim();
    }
    const fallback = metadata.displayName ?? metadata.name ?? metadata.userName;
    return getString(fallback);
};
const safeResolveRole = (resolver, metadata, fallback) => {
    try {
        const resolved = resolver?.(metadata);
        if (isRole(resolved)) {
            return resolved;
        }
    }
    catch (error) {
        console.warn('makeContextStore resolveRole threw, falling back to derived role', error);
    }
    return fallback;
};
const safeResolveName = (resolver, metadata) => {
    if (!resolver) {
        return undefined;
    }
    try {
        return resolver(metadata);
    }
    catch (error) {
        console.warn('makeContextStore resolveDisplayName threw, falling back to metadata', error);
        return undefined;
    }
};
const isRole = (value) => value === 'assistant' || value === 'system' || value === 'user';
const getString = (value) => typeof value === 'string' && value.trim().length > 0 ? value : undefined;
const toEpochMilliseconds = (value) => {
    if (value instanceof Date) {
        return value.getTime();
    }
    if (typeof value === 'string') {
        return new Date(value).getTime();
    }
    return Number(value);
};
//# sourceMappingURL=makeContextStore.js.map