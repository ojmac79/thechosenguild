(function () {
  const DIRECTORY_STORAGE_KEY = 'theChosenGuildDirectoryV1';
  const CURRENT_MEMBER_STORAGE_KEY = 'theChosenCurrentMember';
  const OWNER_EMAIL = 'ojmac79@gmail.com';
  const ACTIVE_STATUSES = new Set(['active', 'probation']);
  const LEVEL_ORDER = Object.freeze({
    leader: 0,
    officer: 1,
    member: 2,
    applicant: 3,
    retired: 4
  });
  const MEMBERSHIP_API_ENDPOINT = '/.netlify/functions/guild-membership';
  const MEMBERSHIP_EVENT_NAME = 'thechosenguild:membershipchange';
  let fallbackIdCounter = 0;
  let cachedDirectory = null;
  let cachedSelfContext;
  let initializationPromise = null;
  let hasLoadedDirectoryFromServer = false;

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

  function normalizeDirectory(directory) {
    const parsed = directory && typeof directory === 'object' ? directory : {};
    const sourceMembers = Array.isArray(parsed.members) ? parsed.members : [];
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
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
      members
    };
  }

  function sanitizeMember(user) {
    if (!user || !user.email) {
      return null;
    }
    const normalizedEmail = normalizeEmail(user.email);
    if (!normalizedEmail) {
      return null;
    }
    return {
      id: user.id || normalizedEmail,
      name: cleanText(
        (user.user_metadata && user.user_metadata.full_name) ||
          user.name ||
          (user.email ? user.email.split('@')[0] : ''),
        80
      ),
      email: normalizedEmail,
      avatar: cleanText(
        (user.user_metadata && user.user_metadata.avatar_url) || user.avatar_url || user.avatar || '',
        500
      )
    };
  }

  function buildPermissions(member, record, authenticated) {
    const email = normalizeEmail(member && member.email);
    const isOwner = Boolean(authenticated && record && record.email === OWNER_EMAIL);
    const status = record ? record.status : authenticated ? 'pending' : 'guest';
    const statusAllowsAccess = Boolean(record && (ACTIVE_STATUSES.has(status) || isOwner));

    return {
      isSignedIn: Boolean(authenticated && member && email),
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

  cachedSelfContext = {
    authenticated: false,
    member: null,
    record: null,
    permissions: buildPermissions(null, null, false)
  };

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

  function clearCurrentMember() {
    localStorage.removeItem(CURRENT_MEMBER_STORAGE_KEY);
  }

  function readCachedDirectoryStorage() {
    try {
      const parsed = JSON.parse(localStorage.getItem(DIRECTORY_STORAGE_KEY) || 'null');
      return normalizeDirectory(parsed);
    } catch (error) {
      return normalizeDirectory(null);
    }
  }

  function persistDirectory(directory) {
    const normalized = normalizeDirectory(directory);
    cachedDirectory = normalized;
    hasLoadedDirectoryFromServer = true;
    localStorage.setItem(DIRECTORY_STORAGE_KEY, JSON.stringify(normalized));
    dispatchMembershipChange();
    return clone(normalized);
  }

  function clearDirectoryCache() {
    cachedDirectory = normalizeDirectory(null);
    hasLoadedDirectoryFromServer = false;
    localStorage.removeItem(DIRECTORY_STORAGE_KEY);
    dispatchMembershipChange();
  }

  function dispatchMembershipChange() {
    window.dispatchEvent(new CustomEvent(MEMBERSHIP_EVENT_NAME, {
      detail: {
        member: getCurrentMember(),
        permissions: clone(cachedSelfContext.permissions),
        record: cachedSelfContext.record ? clone(cachedSelfContext.record) : null,
        directory: cachedDirectory ? clone(cachedDirectory) : null
      }
    }));
  }

  function hasIdentitySession() {
    return Boolean(
      window.netlifyIdentity &&
      typeof window.netlifyIdentity.currentUser === 'function' &&
      window.netlifyIdentity.currentUser()
    );
  }

  async function getAuthToken() {
    const identityUser = window.netlifyIdentity && typeof window.netlifyIdentity.currentUser === 'function'
      ? window.netlifyIdentity.currentUser()
      : null;
    if (!identityUser || typeof identityUser.jwt !== 'function') {
      return '';
    }

    try {
      const token = await identityUser.jwt();
      return typeof token === 'string' ? token : '';
    } catch (error) {
      return '';
    }
  }

  async function requestMembership(url, options) {
    const init = { ...options };
    const headers = new Headers(init.headers || {});
    const token = await getAuthToken();
    if (token) {
      headers.set('Authorization', 'Bearer '.concat(token));
    }
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    init.headers = headers;

    const response = await fetch(url, init);
    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        payload = { error: text };
      }
    }

    if (!response.ok) {
      throw new Error(payload.error || `Membership request failed (${response.status}).`);
    }

    return payload;
  }

  function setSelfContext(payload, fallbackMember, authenticatedOverride) {
    const member = sanitizeMember((payload && payload.member) || fallbackMember);
    const record = normalizeRecord(payload && payload.record);
    const authenticated = typeof authenticatedOverride === 'boolean'
      ? authenticatedOverride
      : Boolean(payload && payload.authenticated && member);
    cachedSelfContext = {
      authenticated,
      member,
      record,
      permissions: buildPermissions(member, record, authenticated)
    };

    if (member && (authenticated || hasIdentitySession())) {
      saveCurrentMember(member);
    } else {
      clearCurrentMember();
    }

    dispatchMembershipChange();
    return clone(cachedSelfContext);
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

  async function refreshSelfContext() {
    const member = getCurrentMember();
    if (!member) {
      setSelfContext({ member: null, record: null }, null, false);
      return clone(cachedSelfContext);
    }

    const payload = await requestMembership(`${MEMBERSHIP_API_ENDPOINT}?view=self`, { method: 'GET' });
    return setSelfContext(payload, member, Boolean(payload && payload.authenticated));
  }

  async function initialize(options) {
    const force = Boolean(options && options.force);
    if (!force && initializationPromise) {
      return initializationPromise;
    }

    initializationPromise = refreshSelfContext().catch((error) => {
      const member = getCurrentMember();
      setSelfContext({ member, record: null }, member, false);
      initializationPromise = null;
      throw error;
    });

    return initializationPromise;
  }

  async function loadDirectory(options) {
    const force = Boolean(options && options.force);
    if (!cachedDirectory) {
      cachedDirectory = readCachedDirectoryStorage();
    }
    if (!force && hasLoadedDirectoryFromServer) {
      return clone(cachedDirectory);
    }

    const payload = await requestMembership(`${MEMBERSHIP_API_ENDPOINT}?view=directory`, { method: 'GET' });
    return persistDirectory(payload.directory);
  }

  function readDirectory() {
    if (!cachedDirectory) {
      cachedDirectory = readCachedDirectoryStorage();
    }
    return clone(cachedDirectory);
  }

  function findRecordByEmail(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return null;
    }
    return readDirectory().members.find((record) => record.email === normalizedEmail) || null;
  }

  async function upsertRecord(input) {
    const payload = await requestMembership(MEMBERSHIP_API_ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(input)
    });
    persistDirectory(payload.directory);

    const currentMember = getCurrentMember();
    if (currentMember && normalizeEmail(currentMember.email) === normalizeEmail(payload.record && payload.record.email)) {
      setSelfContext({ member: currentMember, record: payload.record }, currentMember, true);
    }

    return normalizeRecord(payload.record);
  }

  async function removeRecord(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return false;
    }
    const payload = await requestMembership(`${MEMBERSHIP_API_ENDPOINT}?email=${encodeURIComponent(normalizedEmail)}`, {
      method: 'DELETE'
    });
    persistDirectory(payload.directory);
    return Boolean(payload.removed);
  }

  function getGuildRecord(memberOrEmail) {
    const email = typeof memberOrEmail === 'string'
      ? normalizeEmail(memberOrEmail)
      : normalizeEmail(memberOrEmail && memberOrEmail.email);
    if (!email) {
      return null;
    }

    if (cachedSelfContext.record && cachedSelfContext.record.email === email) {
      return clone(cachedSelfContext.record);
    }

    return findRecordByEmail(email);
  }

  async function ensureMemberRecord(member) {
    const currentMember = sanitizeMember(member) || getCurrentMember();
    if (!currentMember) {
      setSelfContext({ member: null, record: null }, null, false);
      return null;
    }

    const context = await refreshSelfContext();
    return context.record ? clone(context.record) : null;
  }

  function getPermissions(member) {
    const normalizedEmail = normalizeEmail(member && member.email);
    if (
      normalizedEmail &&
      cachedSelfContext.member &&
      cachedSelfContext.authenticated &&
      normalizeEmail(cachedSelfContext.member.email) === normalizedEmail
    ) {
      return clone(cachedSelfContext.permissions);
    }

    return buildPermissions(member, null, false);
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

  cachedDirectory = readCachedDirectoryStorage();

  window.TheChosenGuildAccess = {
    OWNER_EMAIL,
    LEVEL_ORDER,
    DIRECTORY_STORAGE_KEY,
    CURRENT_MEMBER_STORAGE_KEY,
    normalizeEmail,
    sanitizeMember,
    readDirectory,
    readStoredMember,
    saveCurrentMember,
    clearCurrentMember,
    getCurrentMember,
    initialize,
    ready: initialize,
    refreshSelfContext,
    ensureMemberRecord,
    loadDirectory,
    findRecordByEmail,
    getGuildRecord,
    upsertRecord,
    removeRecord,
    getPermissions,
    getMemberLabel,
    getDashboardStats,
    clone,
    MEMBERSHIP_EVENT_NAME
  };
})();
