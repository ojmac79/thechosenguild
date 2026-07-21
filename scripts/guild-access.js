(function () {
  const DIRECTORY_STORAGE_KEY = 'theChosenGuildDirectoryV1';
  const CURRENT_MEMBER_STORAGE_KEY = 'theChosenCurrentMember';
  const MEMBER_AVATARS_STORAGE_KEY = 'theChosenMemberAvatarsV1';
  const OWNER_EMAIL = 'ojmac79@gmail.com';
  const ACTIVE_STATUSES = new Set(['active', 'probation']);
  const MEMBER_ACTIVITY_REFRESH_MS = 5 * 60 * 1000;
  const LEVEL_ORDER = Object.freeze({
    leader: 0,
    officer: 1,
    member: 2,
    applicant: 3,
    retired: 4
  });
  let fallbackIdCounter = 0;

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function buildId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }
    fallbackIdCounter += 1;
    return `${prefix}-${Date.now()}-${fallbackIdCounter}`;
  }

  function cleanText(value, maxLength) {
    return String(value || '').trim().slice(0, maxLength);
  }

  function defaultRecord(email) {
    const normalizedEmail = normalizeEmail(email);
    const owner = normalizedEmail === OWNER_EMAIL;
    const now = nowIso();
    return {
      id: buildId('guild-member'),
      email: normalizedEmail,
      name: owner ? 'OJ Mac' : '',
      title: owner ? 'Guild Leader' : 'Verified Visitor',
      level: owner ? 'leader' : 'applicant',
      status: owner ? 'active' : 'pending',
      notes: owner ? 'Site owner and guild leader.' : '',
      verifiedNetlify: owner,
      lastSeenAt: owner ? now : '',
      createdAt: now,
      updatedAt: now,
      access: {
        forums: owner,
        roster: owner,
        moderateForums: owner,
        management: owner
      }
    };
  }

  function normalizeAccess(access, isOwner) {
    const next = {
      forums: Boolean(access && access.forums),
      roster: Boolean(access && access.roster),
      moderateForums: Boolean(access && access.moderateForums),
      management: Boolean(access && access.management)
    };

    if (isOwner) {
      next.forums = true;
      next.roster = true;
      next.moderateForums = true;
      next.management = true;
    }

    return next;
  }

  function normalizeRecord(record) {
    if (!record || typeof record !== 'object') {
      return null;
    }

    const email = normalizeEmail(record.email);
    if (!email) {
      return null;
    }

    const owner = email === OWNER_EMAIL;
    const base = defaultRecord(email);
    const normalized = {
      ...base,
      ...record,
      email,
      name: cleanText(record.name || base.name, 80),
      title: cleanText(record.title || base.title, 80),
      level: cleanText(record.level || base.level, 40) || base.level,
      status: cleanText(record.status || base.status, 40) || base.status,
      notes: cleanText(record.notes || base.notes, 800),
      verifiedNetlify: owner ? true : Boolean(record.verifiedNetlify),
      lastSeenAt: typeof record.lastSeenAt === 'string' ? record.lastSeenAt : base.lastSeenAt,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : base.createdAt,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : base.updatedAt,
      access: normalizeAccess(record.access, owner)
    };

    if (owner) {
      normalized.level = 'leader';
      normalized.status = 'active';
      normalized.title = normalized.title || 'Guild Leader';
    } else if (normalized.level === 'leader') {
      normalized.level = 'officer';
      normalized.access.management = false;
    }

    normalized.searchBlob = [
      normalized.name,
      normalized.email,
      normalized.title,
      normalized.level,
      normalized.status,
      normalized.notes
    ]
      .join(' ')
      .toLowerCase();

    return normalized;
  }

  function readAvatarMap() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MEMBER_AVATARS_STORAGE_KEY) || 'null');
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function getCustomAvatar(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return '';
    }
    const map = readAvatarMap();
    const stored = String(map[normalizedEmail] || '');
    // Data URLs (canvas uploads) are stored verbatim; remote URLs are length-capped.
    return stored.startsWith('data:image/') ? stored : cleanText(stored, 500);
  }

  function setCustomAvatar(email, url) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return false;
    }
    const raw = String(url || '');
    // Data URLs from canvas uploads are stored verbatim (no length cap applied).
    // Remote URLs are cleaned and validated as before.
    const isDataUrl = raw.startsWith('data:image/');
    const cleaned = isDataUrl ? raw : cleanText(raw, 500);
    if (cleaned && !isDataUrl) {
      try {
        const parsedUrl = new URL(cleaned);
        if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
          return false;
        }
      } catch (e) {
        return false;
      }
    }
    const map = readAvatarMap();
    if (cleaned) {
      map[normalizedEmail] = cleaned;
    } else {
      delete map[normalizedEmail];
    }
    localStorage.setItem(MEMBER_AVATARS_STORAGE_KEY, JSON.stringify(map));
    return true;
  }

  function sanitizeMember(user) {
    if (!user || !user.email) {
      return null;
    }
    const normalizedEmail = normalizeEmail(user.email);
    if (!normalizedEmail) {
      return null;
    }
    const netlifyAvatar = cleanText(
      (user.user_metadata && user.user_metadata.avatar_url) || user.avatar_url || user.avatar || '',
      500
    );
    const customAvatar = getCustomAvatar(normalizedEmail);
    return {
      id: user.id || normalizedEmail,
      name: cleanText(
        (user.user_metadata && user.user_metadata.full_name) ||
          user.name ||
          (user.email ? user.email.split('@')[0] : ''),
        80
      ),
      email: normalizedEmail,
      avatar: customAvatar || netlifyAvatar
    };
  }

  function readStoredMember() {
    const stored = localStorage.getItem(CURRENT_MEMBER_STORAGE_KEY);
    if (!stored) {
      return null;
    }

    try {
      const parsed = JSON.parse(stored);
      return sanitizeMember(parsed);
    } catch (error) {
      return null;
    }
  }

  function saveCurrentMember(member) {
    if (!member) {
      localStorage.removeItem(CURRENT_MEMBER_STORAGE_KEY);
      return null;
    }

    const sanitized = sanitizeMember(member);
    if (!sanitized) {
      return null;
    }

    localStorage.setItem(CURRENT_MEMBER_STORAGE_KEY, JSON.stringify(sanitized));
    return sanitized;
  }

  function readDirectory() {
    let parsed = null;
    try {
      parsed = JSON.parse(localStorage.getItem(DIRECTORY_STORAGE_KEY) || 'null');
    } catch (error) {
      parsed = null;
    }

    const sourceMembers = Array.isArray(parsed && parsed.members) ? parsed.members : [];
    const seen = new Set();
    const members = sourceMembers
      .map(normalizeRecord)
      .filter((record) => {
        if (!record || seen.has(record.email)) {
          return false;
        }
        seen.add(record.email);
        return true;
      });

    if (!seen.has(OWNER_EMAIL)) {
      members.unshift(defaultRecord(OWNER_EMAIL));
    }

    return {
      version: 1,
      updatedAt: typeof (parsed && parsed.updatedAt) === 'string' ? parsed.updatedAt : nowIso(),
      members
    };
  }

  function writeDirectory(directory) {
    const normalizedMembers = Array.isArray(directory && directory.members)
      ? directory.members.map(normalizeRecord).filter(Boolean)
      : [];

    const seen = new Set();
    const dedupedMembers = normalizedMembers.filter((record) => {
      if (seen.has(record.email)) {
        return false;
      }
      seen.add(record.email);
      return true;
    });

    if (!seen.has(OWNER_EMAIL)) {
      dedupedMembers.unshift(defaultRecord(OWNER_EMAIL));
    }

    const payload = {
      version: 1,
      updatedAt: nowIso(),
      members: dedupedMembers
    };
    localStorage.setItem(DIRECTORY_STORAGE_KEY, JSON.stringify(payload));
    return payload;
  }

  function findRecordByEmail(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return null;
    }
    return readDirectory().members.find((record) => record.email === normalizedEmail) || null;
  }

  function upsertRecord(input) {
    const normalizedInput = normalizeRecord(input);
    if (!normalizedInput) {
      return null;
    }

    const directory = readDirectory();
    const index = directory.members.findIndex((record) => record.email === normalizedInput.email);
    const existing = index >= 0 ? directory.members[index] : null;
    const nextRecord = normalizeRecord({
      ...(existing || defaultRecord(normalizedInput.email)),
      ...normalizedInput,
      access: normalizeAccess(
        {
          ...(existing && existing.access ? existing.access : {}),
          ...(normalizedInput.access || {})
        },
        normalizedInput.email === OWNER_EMAIL
      ),
      updatedAt: nowIso()
    });

    if (index >= 0) {
      directory.members[index] = nextRecord;
    } else {
      directory.members.unshift(nextRecord);
    }

    writeDirectory(directory);
    return nextRecord;
  }

  function removeRecord(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || normalizedEmail === OWNER_EMAIL) {
      return false;
    }

    const directory = readDirectory();
    const nextMembers = directory.members.filter((record) => record.email !== normalizedEmail);
    if (nextMembers.length === directory.members.length) {
      return false;
    }

    writeDirectory({ ...directory, members: nextMembers });
    return true;
  }

  function getCurrentMember() {
    const storedMember = readStoredMember();
    const identityMember = sanitizeMember(
      window.netlifyIdentity && typeof window.netlifyIdentity.currentUser === 'function'
        ? window.netlifyIdentity.currentUser()
        : null
    );

    if (identityMember) {
      saveCurrentMember(identityMember);
      return identityMember;
    }

    return storedMember;
  }

  function ensureMemberRecord(member) {
    const sanitizedMember = sanitizeMember(member);
    if (!sanitizedMember) {
      return null;
    }

    const existing = findRecordByEmail(sanitizedMember.email);
    const existingLastSeen = existing && existing.lastSeenAt ? Date.parse(existing.lastSeenAt) : NaN;
    const shouldUpdateLastSeen = !Number.isFinite(existingLastSeen) || Date.now() - existingLastSeen > MEMBER_ACTIVITY_REFRESH_MS;
    const needsWrite =
      !existing ||
      !existing.verifiedNetlify ||
      existing.name !== (sanitizedMember.name || existing.name) ||
      shouldUpdateLastSeen;

    if (!needsWrite) {
      return existing;
    }

    const nextRecord = normalizeRecord({
      ...(existing || defaultRecord(sanitizedMember.email)),
      email: sanitizedMember.email,
      name: sanitizedMember.name || (existing && existing.name) || '',
      verifiedNetlify: true,
      lastSeenAt: nowIso(),
      updatedAt: nowIso()
    });

    return upsertRecord(nextRecord);
  }

  function getGuildRecord(memberOrEmail) {
    if (!memberOrEmail) {
      return null;
    }
    const email = typeof memberOrEmail === 'string' ? memberOrEmail : memberOrEmail.email;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return null;
    }

    const existing = findRecordByEmail(normalizedEmail);
    if (existing) {
      return existing;
    }

    if (normalizedEmail === OWNER_EMAIL) {
      return defaultRecord(normalizedEmail);
    }

    if (typeof memberOrEmail === 'object' && memberOrEmail.email) {
      return normalizeRecord({
        ...defaultRecord(normalizedEmail),
        email: normalizedEmail,
        name: memberOrEmail.name || '',
        verifiedNetlify: true,
        lastSeenAt: nowIso()
      });
    }

    return null;
  }

  function getPermissions(member) {
    const record = getGuildRecord(member);
    const email = normalizeEmail(member && member.email);
    const isOwner = email === OWNER_EMAIL;
    const status = record ? record.status : 'guest';
    const statusAllowsAccess = ACTIVE_STATUSES.has(status) || isOwner;

    return {
      isSignedIn: Boolean(member && email),
      isOwner,
      record,
      level: record ? record.level : 'guest',
      title: record ? record.title : 'Visitor',
      status,
      canUseForums: Boolean(record && record.access.forums && statusAllowsAccess),
      canUseRoster: Boolean(record && record.access.roster && statusAllowsAccess),
      canModerateForums: Boolean(record && record.access.moderateForums && statusAllowsAccess),
      canManageGuild: Boolean(record && record.access.management && statusAllowsAccess)
    };
  }

  function getMemberLabel(record) {
    if (!record) {
      return 'Guest';
    }
    return cleanText(record.title || record.level || 'Member', 80) || 'Member';
  }

  function getDashboardStats() {
    const directory = readDirectory();
    const stats = {
      total: directory.members.length,
      active: 0,
      pending: 0,
      officers: 0,
      forumAccess: 0,
      rosterAccess: 0
    };

    directory.members.forEach((record) => {
      if (record.status === 'active') {
        stats.active += 1;
      }
      if (record.status === 'pending') {
        stats.pending += 1;
      }
      if (record.level === 'leader' || record.level === 'officer') {
        stats.officers += 1;
      }
      if (record.access.forums) {
        stats.forumAccess += 1;
      }
      if (record.access.roster) {
        stats.rosterAccess += 1;
      }
    });

    return stats;
  }

  window.TheChosenGuildAccess = {
    OWNER_EMAIL,
    LEVEL_ORDER,
    DIRECTORY_STORAGE_KEY,
    CURRENT_MEMBER_STORAGE_KEY,
    MEMBER_AVATARS_STORAGE_KEY,
    normalizeEmail,
    sanitizeMember,
    readDirectory,
    writeDirectory,
    readStoredMember,
    saveCurrentMember,
    getCurrentMember,
    ensureMemberRecord,
    findRecordByEmail,
    getGuildRecord,
    upsertRecord,
    removeRecord,
    getPermissions,
    getMemberLabel,
    getDashboardStats,
    getCustomAvatar,
    setCustomAvatar,
    clone
  };

  writeDirectory(readDirectory());
})();
