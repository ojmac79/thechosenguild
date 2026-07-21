const OWNER_EMAIL = 'ojmac79@gmail.com';
const ACTIVE_STATUSES = new Set(['active', 'probation']);
const LEVEL_ORDER = Object.freeze({
  leader: 0,
  officer: 1,
  member: 2,
  applicant: 3,
  retired: 4
});
const STORE_NAME = 'guild-membership';
const DIRECTORY_KEY = 'directory';

let fallbackIdCounter = 0;

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function buildId(prefix) {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  fallbackIdCounter += 1;
  return `${prefix}-${Date.now()}-${fallbackIdCounter}`;
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

function sanitizeMember(user) {
  if (!user || !user.email) {
    return null;
  }

  const normalizedEmail = normalizeEmail(user.email);
  if (!normalizedEmail) {
    return null;
  }

  return {
    id: user.sub || user.id || normalizedEmail,
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function response(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(payload)
  };
}

function parseBody(body) {
  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error('Invalid JSON body.');
  }
}

async function getStore() {
  const { getStore } = await import('@netlify/blobs');
  return getStore(STORE_NAME);
}

async function readDirectory(store) {
  const parsed = await store.get(DIRECTORY_KEY, { type: 'json' });
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
    })
    .sort((a, b) => {
      const rankDiff = (LEVEL_ORDER[a.level] ?? 99) - (LEVEL_ORDER[b.level] ?? 99);
      if (rankDiff !== 0) {
        return rankDiff;
      }
      return a.email.localeCompare(b.email);
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

async function writeDirectory(store, directory) {
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

  await store.setJSON(DIRECTORY_KEY, payload);
  return payload;
}

function findRecordByEmail(directory, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }
  return directory.members.find((record) => record.email === normalizedEmail) || null;
}

async function upsertRecord(store, input) {
  const normalizedInput = normalizeRecord(input);
  if (!normalizedInput) {
    throw new Error('A valid member email is required.');
  }

  const directory = await readDirectory(store);
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

  const nextDirectory = await writeDirectory(store, directory);
  return {
    directory: nextDirectory,
    record: findRecordByEmail(nextDirectory, nextRecord.email)
  };
}

async function removeRecord(store, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || normalizedEmail === OWNER_EMAIL) {
    return { removed: false, directory: await readDirectory(store) };
  }

  const directory = await readDirectory(store);
  const nextMembers = directory.members.filter((record) => record.email !== normalizedEmail);
  if (nextMembers.length === directory.members.length) {
    return { removed: false, directory };
  }

  const nextDirectory = await writeDirectory(store, { ...directory, members: nextMembers });
  return { removed: true, directory: nextDirectory };
}

async function syncAuthenticatedMember(store, user) {
  const member = sanitizeMember(user);
  if (!member) {
    return null;
  }

  const directory = await readDirectory(store);
  const existing = findRecordByEmail(directory, member.email);
  const existingLastSeen = existing && existing.lastSeenAt ? Date.parse(existing.lastSeenAt) : NaN;
  const shouldUpdateLastSeen = !Number.isFinite(existingLastSeen) || Date.now() - existingLastSeen > 5 * 60 * 1000;
  const nextRecord = normalizeRecord({
    ...(existing || defaultRecord(member.email)),
    email: member.email,
    name: member.name || (existing && existing.name) || '',
    verifiedNetlify: true,
    lastSeenAt: shouldUpdateLastSeen ? nowIso() : existing && existing.lastSeenAt,
    updatedAt: nowIso()
  });

  const result = await upsertRecord(store, nextRecord);
  return {
    member,
    record: result.record,
    directory: result.directory,
    permissions: buildPermissions(member, result.record, true)
  };
}

exports.handler = async (event, context) => {
  try {
    const store = await getStore();
    const user = context && context.clientContext ? context.clientContext.user : null;
    const member = sanitizeMember(user);
    const isOwner = Boolean(member && member.email === OWNER_EMAIL);

    if (event.httpMethod === 'GET') {
      const view = String((event.queryStringParameters && event.queryStringParameters.view) || 'self');
      if (view === 'directory') {
        if (!isOwner) {
          return response(403, { error: 'Guild management access is required.' });
        }
        const directory = await readDirectory(store);
        return response(200, { directory });
      }

      if (!member) {
        return response(200, {
          authenticated: false,
          member: null,
          record: null,
          permissions: buildPermissions(null, null, false)
        });
      }

      const session = await syncAuthenticatedMember(store, user);
      return response(200, {
        authenticated: true,
        member: session.member,
        record: session.record,
        permissions: session.permissions
      });
    }

    if (event.httpMethod === 'POST') {
      if (!isOwner) {
        return response(403, { error: 'Guild management access is required.' });
      }
      const payload = parseBody(event.body);
      const result = await upsertRecord(store, payload);
      return response(200, {
        record: result.record,
        directory: result.directory
      });
    }

    if (event.httpMethod === 'DELETE') {
      if (!isOwner) {
        return response(403, { error: 'Guild management access is required.' });
      }
      const email = event.queryStringParameters && event.queryStringParameters.email;
      const result = await removeRecord(store, email);
      return response(200, result);
    }

    return response(405, { error: 'Method not allowed.' });
  } catch (error) {
    return response(500, { error: error && error.message ? error.message : 'Unexpected server error.' });
  }
};
