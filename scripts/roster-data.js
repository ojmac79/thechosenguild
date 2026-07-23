(function () {
  const SNAPSHOT_STORAGE_KEY = 'theChosenRosterSnapshotV2';
  const LEGACY_STORAGE_KEY = 'theChosenRosterEntries';
  const DAYBREAK_SERVICE_ID_STORAGE_KEY = 'theChosenDaybreakServiceId';
  const GUILD_NAME = 'The Chosen';
  const WORLD_NAME = 'Qeynos';
  const DEFAULT_SYNC_INTERVAL_MS = 86400000; // 24 hours in milliseconds
  const RANDOM_ID_SUFFIX_LENGTH = 7;
  const OFFICIAL_SOURCE_URL = 'https://census.daybreakgames.com/';
  const DEFAULT_DAYBREAK_SERVICE_ID = 's:Murphy';
  const ALLOWED_CENSUS_COLLECTIONS = Object.freeze(new Set([
    'eq2/guild_member',
    'eq2/character',
    'eq2/guild',
    'eql:guild',
    'eq_legends:guild'
  ]));

  function getSyncIntervalMs() {
    const configured = Number(window.TheChosenRosterSyncIntervalMs || DEFAULT_SYNC_INTERVAL_MS);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SYNC_INTERVAL_MS;
  }

  function getServiceId() {
    const configured =
      window.TheChosenDaybreakServiceId ||
      localStorage.getItem(DAYBREAK_SERVICE_ID_STORAGE_KEY) ||
      DEFAULT_DAYBREAK_SERVICE_ID;
    const trimmed = String(configured || DEFAULT_DAYBREAK_SERVICE_ID).trim();
    return /^s:[A-Za-z0-9]+$/.test(trimmed) ? trimmed : DEFAULT_DAYBREAK_SERVICE_ID;
  }

  function sanitizeCollection(value) {
    const collection = String(value || '').trim();
    if (!ALLOWED_CENSUS_COLLECTIONS.has(collection)) {
      throw new Error(
        `Invalid Census collection path "${collection}". Allowed: ${Array.from(ALLOWED_CENSUS_COLLECTIONS).join(', ')}`
      );
    }
    return collection;
  }

  function buildCensusUrl(collection, query) {
    return `${OFFICIAL_SOURCE_URL}${getServiceId()}/json/get/${sanitizeCollection(collection)}?${query}`;
  }

  function buildQuery(params) {
    return new URLSearchParams(params).toString();
  }

  function buildSourceAttempts() {
    const guildLower = GUILD_NAME.toLowerCase();
    const eq2GuildMemberBase = {
      'guild.world.name': WORLD_NAME,
      'c:limit': '500',
      'c:resolve': 'character'
    };
    const eq2CharacterBase = {
      'guild.world.name': WORLD_NAME,
      'c:limit': '500'
    };
    const guildBase = {
      'world.name': WORLD_NAME,
      'c:limit': '10'
    };

    return Object.freeze([
      {
        label: 'EQ2 guild members',
        url: buildCensusUrl(
          'eq2/guild_member',
          buildQuery({
            'guild.name.lower': guildLower,
            ...eq2GuildMemberBase
          })
        )
      },
      {
        label: 'EQ2 guild members (name fallback)',
        url: buildCensusUrl(
          'eq2/guild_member',
          buildQuery({
            'guild.name': GUILD_NAME,
            ...eq2GuildMemberBase
          })
        )
      },
      {
        label: 'EQ2 guild characters',
        url: buildCensusUrl(
          'eq2/character',
          buildQuery({
            'guild.name.lower': guildLower,
            ...eq2CharacterBase
          })
        )
      },
      {
        label: 'EQ2 guild details',
        url: buildCensusUrl(
          'eq2/guild',
          buildQuery({
            'name.lower': guildLower,
            ...guildBase
          })
        )
      },
      {
        label: 'EQL guild details',
        url: buildCensusUrl(
          'eql:guild',
          buildQuery({
            'name.lower': guildLower,
            ...guildBase
          })
        )
      },
      {
        label: 'EQ Legends guild details',
        url: buildCensusUrl(
          'eq_legends:guild',
          buildQuery({
            'name.lower': guildLower,
            ...guildBase
          })
        )
      }
    ]);
  }

  const SYNC_INTERVAL_MS = getSyncIntervalMs();

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeEmail(value) {
    const guildAccess = window.TheChosenGuildAccess;
    if (guildAccess && typeof guildAccess.normalizeEmail === 'function') {
      return guildAccess.normalizeEmail(value);
    }
    return String(value || '').trim().toLowerCase();
  }

  function titleCase(value) {
    return String(value || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b([a-z])/gi, (match) => match.toUpperCase());
  }

  function textFromValue(value) {
    if (value == null) {
      return '';
    }
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value).trim();
    }
    if (Array.isArray(value)) {
      return value.map(textFromValue).find(Boolean) || '';
    }
    if (typeof value === 'object') {
      return (
        textFromValue(value.en) ||
        textFromValue(value.first) ||
        textFromValue(value.last) ||
        textFromValue(value.name) ||
        textFromValue(value.displayname) ||
        textFromValue(value.value) ||
        ''
      );
    }
    return '';
  }

  function getPath(object, path) {
    return String(path || '')
      .split('.')
      .filter(Boolean)
      .reduce((result, part) => {
        if (result == null) {
          return undefined;
        }
        return result[part];
      }, object);
  }

  function pickText(object, paths) {
    for (const path of paths) {
      const value = textFromValue(getPath(object, path));
      if (value) {
        return value;
      }
    }
    return '';
  }

  function pickNumber(object, paths) {
    for (const path of paths) {
      const value = getPath(object, path);
      if (value == null || value === '') {
        continue;
      }
      const number = Number(value);
      if (Number.isFinite(number)) {
        return number;
      }
      const text = textFromValue(value);
      const match = text.match(/\d+/);
      if (match) {
        return Number(match[0]);
      }
    }
    return null;
  }

  function normalizeCharacterName(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  function splitCharacterName(name) {
    const trimmed = String(name || '').trim().replace(/\s+/g, ' ');
    if (!trimmed) {
      return { firstName: '', lastName: '' };
    }
    const parts = trimmed.split(' ');
    return {
      firstName: parts[0] || '',
      lastName: parts.slice(1).join(' ')
    };
  }

  function extractName(record) {
    const direct = pickText(record, [
      'displayname',
      'display_name',
      'character_name',
      'full_name',
      'name.full',
      'name.displayname',
      'character.displayname',
      'character.name',
      'member.name',
      'player.name',
      'name'
    ]);
    if (direct && typeof getPath(record, 'name') !== 'object') {
      return direct;
    }

    const first = pickText(record, [
      'name.first',
      'character.name.first',
      'character.first_name',
      'first_name',
      'firstName'
    ]);
    const last = pickText(record, [
      'name.last',
      'character.name.last',
      'character.last_name',
      'last_name',
      'lastName'
    ]);
    const combined = [first, last].filter(Boolean).join(' ').trim();
    return combined || direct;
  }

  function extractClasses(record) {
    const values = [];
    const directPaths = [
      'class_1', 'class_2', 'class_3',
      'class1', 'class2', 'class3',
      'classOne', 'classTwo', 'classThree',
      'character.class_1', 'character.class_2', 'character.class_3',
      'character.class1', 'character.class2', 'character.class3',
      'type.class', 'type.subclass', 'profession', 'profession.name',
      'archetype', 'archetype.name', 'adventure_class', 'adventure_class.name',
      'class', 'class.name'
    ];

    directPaths.forEach((path) => {
      const text = pickText(record, [path]);
      if (text) {
        values.push(text);
      }
    });

    const classesValue = getPath(record, 'classes') || getPath(record, 'class_list') || getPath(record, 'classList');
    if (Array.isArray(classesValue)) {
      classesValue.forEach((item) => {
        const text = textFromValue(item);
        if (text) {
          values.push(text);
        }
      });
    } else if (classesValue && typeof classesValue === 'object') {
      Object.values(classesValue).forEach((item) => {
        const text = textFromValue(item);
        if (text) {
          values.push(text);
        }
      });
    }

    return values
      .map(titleCase)
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index)
      .slice(0, 3);
  }

  function extractRank(record) {
    return titleCase(
      pickText(record, [
        'rank',
        'guild_rank',
        'guild.rank',
        'member_rank',
        'type.rank',
        'title'
      ])
    );
  }

  function extractLevel(record) {
    return pickNumber(record, [
      'level',
      'adventure_level',
      'battle_level',
      'character.level',
      'stats.level',
      'profile.level'
    ]);
  }

  function extractCharacterId(record, fallbackName) {
    return pickText(record, [
      'character_id',
      'id',
      'character.id',
      'player.id',
      'name.id'
    ]) || normalizeCharacterName(fallbackName);
  }

  function extractSourceUpdatedAt(record) {
    return pickText(record, [
      'last_update',
      'last_updated',
      'updated_at',
      'timestamp',
      'modified_at'
    ]);
  }

  function isValidCharacterRecord(characterName, classes, level, rank) {
    return Boolean(characterName && (classes.length > 0 || level != null || rank));
  }

  function buildSearchBlob(entry) {
    return [
      entry.characterName,
      entry.rank,
      entry.classSummary,
      entry.level,
      entry.assignedEmail,
      entry.assignedMemberName
    ]
      .join(' ')
      .toLowerCase();
  }

  function normalizeEntry(input) {
    const name = String(input && input.characterName ? input.characterName : '').trim().replace(/\s+/g, ' ');
    const nameParts = splitCharacterName(name);
    const classes = Array.isArray(input && input.classes)
      ? input.classes.map(titleCase).filter(Boolean).slice(0, 3)
      : [];
    const level = input && input.level != null && input.level !== '' ? Number(input.level) : null;
    const assignedEmail = normalizeEmail(input && input.assignedEmail);
    const assignedMemberName = String(input && input.assignedMemberName ? input.assignedMemberName : '').trim();

    return {
      id: String(
        input && input.id
          ? input.id
          : extractCharacterId(input || {}, name) || `roster-${Date.now()}-${Math.random().toString(36).slice(2, 2 + RANDOM_ID_SUFFIX_LENGTH)}`
      ),
      characterId: String(input && input.characterId ? input.characterId : extractCharacterId(input || {}, name) || ''),
      characterName: name,
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      rank: titleCase(input && input.rank ? input.rank : ''),
      level: Number.isFinite(level) ? level : null,
      classes,
      classSummary: classes.join(' / '),
      assignedEmail,
      assignedMemberName,
      assignedAt: String(input && input.assignedAt ? input.assignedAt : '').trim(),
      sourceUpdatedAt: String(input && input.sourceUpdatedAt ? input.sourceUpdatedAt : '').trim(),
      source: String(input && input.source ? input.source : 'official').trim(),
      searchBlob: ''
    };
  }

  function sortEntries(entries) {
    return entries.slice().sort((left, right) => {
      const byName = left.characterName.localeCompare(right.characterName, undefined, { sensitivity: 'base' });
      if (byName !== 0) {
        return byName;
      }
      return String(left.characterId || left.id).localeCompare(String(right.characterId || right.id));
    });
  }

  function normalizeSnapshot(snapshot) {
    const entries = Array.isArray(snapshot && snapshot.entries)
      ? sortEntries(snapshot.entries.map(normalizeEntry).filter((entry) => entry.characterName))
      : [];
    entries.forEach((entry) => {
      entry.searchBlob = buildSearchBlob(entry);
    });

    return {
      version: 2,
      updatedAt: String(snapshot && snapshot.updatedAt ? snapshot.updatedAt : '').trim(),
      entries,
      source: {
        provider: String(snapshot && snapshot.source && snapshot.source.provider ? snapshot.source.provider : 'Daybreak Census').trim(),
        guildName: String(snapshot && snapshot.source && snapshot.source.guildName ? snapshot.source.guildName : GUILD_NAME).trim(),
        worldName: String(snapshot && snapshot.source && snapshot.source.worldName ? snapshot.source.worldName : WORLD_NAME).trim(),
        fetchedAt: String(snapshot && snapshot.source && snapshot.source.fetchedAt ? snapshot.source.fetchedAt : '').trim(),
        attemptedAt: String(snapshot && snapshot.source && snapshot.source.attemptedAt ? snapshot.source.attemptedAt : '').trim(),
        endpoint: String(snapshot && snapshot.source && snapshot.source.endpoint ? snapshot.source.endpoint : '').trim(),
        status: String(snapshot && snapshot.source && snapshot.source.status ? snapshot.source.status : 'idle').trim(),
        error: String(snapshot && snapshot.source && snapshot.source.error ? snapshot.source.error : '').trim(),
        recordCount: Number.isFinite(Number(snapshot && snapshot.source && snapshot.source.recordCount))
          ? Number(snapshot.source.recordCount)
          : entries.length,
        syncIntervalMs: SYNC_INTERVAL_MS
      }
    };
  }

  function readLegacyEntries() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || 'null');
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function migrateLegacyEntries() {
    const legacyEntries = readLegacyEntries();
    if (!legacyEntries.length) {
      return normalizeSnapshot(null);
    }

    return normalizeSnapshot({
      updatedAt: new Date().toISOString(),
      entries: legacyEntries.map((entry) => ({
        id: entry.id,
        characterId: entry.id,
        characterName: `${entry.firstName || ''} ${entry.lastName || ''}`.trim(),
        rank: '',
        level: entry.level,
        classes: [entry.classOne, entry.classTwo, entry.classThree].filter(Boolean),
        assignedEmail: entry.ownerEmail,
        assignedMemberName: entry.ownerName,
        assignedAt: entry.updatedAt || entry.createdAt || '',
        sourceUpdatedAt: entry.updatedAt || entry.createdAt || '',
        source: 'legacy'
      })),
      source: {
        provider: 'Legacy roster entries',
        guildName: GUILD_NAME,
        worldName: WORLD_NAME,
        fetchedAt: '',
        attemptedAt: '',
        endpoint: '',
        status: 'idle',
        error: '',
        recordCount: legacyEntries.length
      }
    });
  }

  function readSnapshot() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SNAPSHOT_STORAGE_KEY) || 'null');
      if (parsed && typeof parsed === 'object') {
        return normalizeSnapshot(parsed);
      }
    } catch (error) {
      // Fall through to migration.
    }

    const migrated = migrateLegacyEntries();
    writeSnapshot(migrated);
    return migrated;
  }

  function writeSnapshot(snapshot) {
    const normalized = normalizeSnapshot(snapshot);
    localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function getEntryKey(entry) {
    return String(entry.characterId || normalizeCharacterName(entry.characterName));
  }

  function mergeAssignments(nextEntries, previousEntries) {
    const previousById = new Map();
    const previousByName = new Map();

    previousEntries.forEach((entry) => {
      previousById.set(getEntryKey(entry), entry);
      previousByName.set(normalizeCharacterName(entry.characterName), entry);
    });

    return nextEntries.map((entry) => {
      const previous = previousById.get(getEntryKey(entry)) || previousByName.get(normalizeCharacterName(entry.characterName));
      if (!previous) {
        return entry;
      }
      return normalizeEntry({
        ...entry,
        assignedEmail: previous.assignedEmail,
        assignedMemberName: previous.assignedMemberName,
        assignedAt: previous.assignedAt || entry.assignedAt
      });
    });
  }

  function extractEntriesFromList(list) {
    if (!Array.isArray(list)) {
      return [];
    }

    return list
      .map((record) => {
        const characterName = extractName(record);
        const classes = extractClasses(record);
        const level = extractLevel(record);
        const rank = extractRank(record);
        const characterId = extractCharacterId(record, characterName);
        if (!isValidCharacterRecord(characterName, classes, level, rank)) {
          return null;
        }
        return normalizeEntry({
          id: characterId,
          characterId,
          characterName,
          rank,
          level,
          classes,
          sourceUpdatedAt: extractSourceUpdatedAt(record),
          source: 'official'
        });
      })
      .filter(Boolean);
  }

  function collectCandidateLists(payload) {
    const lists = [];

    function visit(node, key) {
      if (Array.isArray(node)) {
        if (node.some((item) => item && typeof item === 'object')) {
          lists.push({ key, list: node });
        }
        node.forEach((item) => visit(item, key));
        return;
      }
      if (!node || typeof node !== 'object') {
        return;
      }
      Object.entries(node).forEach(([childKey, childValue]) => visit(childValue, childKey));
    }

    visit(payload, 'root');
    return lists;
  }

  function extractEntriesFromResponse(payload) {
    const entries = [];
    const seen = new Set();

    collectCandidateLists(payload).forEach(({ list }) => {
      extractEntriesFromList(list).forEach((entry) => {
        const key = getEntryKey(entry);
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        entries.push(entry);
      });
    });

    return sortEntries(entries);
  }

  async function fetchOfficialRoster() {
    let lastError = 'No official roster entries were returned.';

    for (const attempt of buildSourceAttempts()) {
      try {
        const response = await fetch(attempt.url, {
          headers: { Accept: 'application/json' }
        });
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`.trim());
        }
        const payload = await response.json();
        const entries = extractEntriesFromResponse(payload);
        if (!entries.length) {
          lastError = `${attempt.label}: no roster entries found.`;
          continue;
        }
        return {
          entries,
          endpoint: attempt.url,
          provider: attempt.label
        };
      } catch (error) {
        lastError = `${attempt.label}: ${error && error.message ? error.message : 'request failed'}`;
      }
    }

    throw new Error(lastError);
  }

  function needsSync(snapshot, now) {
    const target = snapshot || readSnapshot();
    const basis = Date.parse(target.source.fetchedAt || target.updatedAt || '');
    if (!Number.isFinite(basis)) {
      return true;
    }
    return (now || Date.now()) - basis >= SYNC_INTERVAL_MS;
  }

  async function syncSnapshot(options) {
    const settings = options || {};
    const current = readSnapshot();
    if (!settings.force && !needsSync(current)) {
      return current;
    }

    const attemptedAt = new Date().toISOString();
    try {
      const fetched = await fetchOfficialRoster();
      const mergedEntries = mergeAssignments(fetched.entries, current.entries);
      return writeSnapshot({
        updatedAt: attemptedAt,
        entries: mergedEntries,
        source: {
          provider: fetched.provider,
          guildName: GUILD_NAME,
          worldName: WORLD_NAME,
          fetchedAt: attemptedAt,
          attemptedAt,
          endpoint: fetched.endpoint,
          status: 'success',
          error: '',
          recordCount: mergedEntries.length
        }
      });
    } catch (error) {
      return writeSnapshot({
        ...current,
        source: {
          ...current.source,
          provider: current.source.provider || 'Daybreak Census',
          guildName: GUILD_NAME,
          worldName: WORLD_NAME,
          attemptedAt,
          status: 'error',
          error: error && error.message ? error.message : 'Roster sync failed.',
          recordCount: current.entries.length
        }
      });
    }
  }

  function getAssignableMembers() {
    const guildAccess = window.TheChosenGuildAccess;
    if (!guildAccess || typeof guildAccess.readDirectory !== 'function') {
      return [];
    }

    return guildAccess
      .readDirectory()
      .members.slice()
      .filter((record) => record && record.email)
      .sort((left, right) => {
        const leftLabel = String(left.name || left.email).toLowerCase();
        const rightLabel = String(right.name || right.email).toLowerCase();
        return leftLabel.localeCompare(rightLabel);
      });
  }

  function assignCharacter(entryId, email) {
    const normalizedEmail = normalizeEmail(email);
    const guildAccess = window.TheChosenGuildAccess;
    const snapshot = readSnapshot();
    const members = getAssignableMembers();
    const memberRecord = normalizedEmail
      ? members.find((record) => normalizeEmail(record.email) === normalizedEmail) || null
      : null;

    const entries = snapshot.entries.map((entry) => {
      if (entry.id !== entryId) {
        return entry;
      }
      return normalizeEntry({
        ...entry,
        assignedEmail: normalizedEmail,
        assignedMemberName: memberRecord ? memberRecord.name || memberRecord.email : '',
        assignedAt: normalizedEmail ? new Date().toISOString() : ''
      });
    });

    const next = writeSnapshot({
      ...snapshot,
      updatedAt: new Date().toISOString(),
      entries,
      source: {
        ...snapshot.source,
        recordCount: entries.length
      }
    });

    return next.entries.find((entry) => entry.id === entryId) || null;
  }

  function findAssignedCharacterByEmail(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return null;
    }
    return readSnapshot().entries.find((entry) => normalizeEmail(entry.assignedEmail) === normalizedEmail) || null;
  }

  window.TheChosenRosterData = {
    SNAPSHOT_STORAGE_KEY,
    LEGACY_STORAGE_KEY,
    GUILD_NAME,
    WORLD_NAME,
    OFFICIAL_SOURCE_URL,
    SOURCE_ATTEMPTS: buildSourceAttempts(),
    SYNC_INTERVAL_MS,
    DAYBREAK_SERVICE_ID_STORAGE_KEY,
    clone,
    normalizeEmail,
    normalizeEntry,
    readSnapshot,
    writeSnapshot,
    needsSync,
    syncSnapshot,
    getAssignableMembers,
    assignCharacter,
    findAssignedCharacterByEmail
  };
})();
