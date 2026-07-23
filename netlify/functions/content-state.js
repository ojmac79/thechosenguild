const { connectLambda, getStore } = require('@netlify/blobs');

const OWNER_EMAIL = 'ojmac79@gmail.com';
const STORE_NAME = 'the-chosen-content';
const NEWS_KEY = 'news-posts-v1';
const FORUM_KEY = 'forum-state-v1';
const FORUM_CONFIG_KEY = 'forum-config-v1';
const FORUM_THREAD_PREFIX = 'forum-threads/';
const FORUM_REPLY_PREFIX = 'forum-replies/';
const KV_KEY = 'kv-state-v1';
const DIRECTORY_KEY = 'theChosenGuildDirectoryV1';
const ACTIVE_MEMBER_STATUSES = new Set(['active', 'probation']);
const LOCAL_ONLY_KV_KEYS = new Set([
  'theChosenCurrentMember',
  'theChosenForumStateV2',
  'theChosenNewsPosts'
]);

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

function readScope(event) {
  const scope = String((event.queryStringParameters && event.queryStringParameters.scope) || '').trim().toLowerCase();
  return scope === 'news' || scope === 'forum' || scope === 'kv' ? scope : '';
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function getRequestEmail(context) {
  const user = context && context.clientContext && context.clientContext.user;
  return normalizeEmail(user && user.email);
}

function getRequestUser(context) {
  return context && context.clientContext && context.clientContext.user;
}

async function readJson(store, key, fallback) {
  const value = await store.get(key, { type: 'json' });
  if (!value || typeof value !== 'object') {
    return fallback;
  }
  return value;
}

async function readBlobCollection(store, prefix) {
  const result = await store.list({ prefix });
  const blobs = Array.isArray(result && result.blobs) ? result.blobs : [];
  const values = await Promise.all(blobs.map((blob) => readJson(store, blob.key, null)));
  return values.filter((value) => value && typeof value === 'object');
}

function isValidKvKey(key) {
  return typeof key === 'string' && key.startsWith('theChosen') && !LOCAL_ONLY_KV_KEYS.has(key);
}

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function cleanForumUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2000) {
    return '';
  }
  try {
    const parsed = new URL(raw);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
      return '';
    }
    return parsed.href;
  } catch (error) {
    return '';
  }
}

function cleanForumImage(value) {
  const raw = String(value || '').trim();
  if (/^data:image\/(?:jpeg|png|gif|webp);base64,[a-z0-9+/=\r\n]+$/i.test(raw) && raw.length <= 700000) {
    return raw;
  }
  return cleanForumUrl(raw);
}

function buildId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

function defaultForumState() {
  return {
    public: {
      categories: [
        { id: 'pub-general', name: 'General', description: 'Open discussion for anyone.' },
        { id: 'pub-help', name: 'Help Desk', description: 'Questions for gameplay and setup.' }
      ],
      threads: [],
      replies: []
    },
    private: {
      categories: [
        { id: 'priv-council', name: 'Council', description: 'Officer and moderator planning.' },
        { id: 'priv-raids', name: 'Raid Ops', description: 'Raid strategy and assignments.' }
      ],
      threads: [],
      replies: []
    }
  };
}

function normalizeForumState(source) {
  const fallback = defaultForumState();
  const state = source && typeof source === 'object' ? source : {};
  ['public', 'private'].forEach((spaceKey) => {
    const sourceSpace = state[spaceKey] && typeof state[spaceKey] === 'object' ? state[spaceKey] : {};
    const categories = Array.isArray(sourceSpace.categories)
      ? sourceSpace.categories.map((category) => ({
          id: cleanText(category && category.id, 120),
          name: cleanText(category && category.name, 80),
          description: cleanText(category && category.description, 240)
        })).filter((category) => category.id && category.name && category.description)
      : [];
    const normalizedCategories = categories.length ? categories : fallback[spaceKey].categories;
    const categoryIds = new Set(normalizedCategories.map((category) => category.id));
    const threads = Array.isArray(sourceSpace.threads)
      ? sourceSpace.threads.map((thread) => {
          const title = cleanText(thread && thread.title, 180);
          const body = cleanText(thread && thread.body, 12000);
          if (!title || !body) {
            return null;
          }
          return {
            id: cleanText(thread.id, 160) || buildId(`${spaceKey}-thread`),
            categoryId: categoryIds.has(thread.categoryId) ? thread.categoryId : normalizedCategories[0].id,
            title,
            body,
            linkUrl: cleanForumUrl(thread.linkUrl),
            imageUrl: cleanForumImage(thread.imageUrl),
            authorName: cleanText(thread.authorName, 100) || 'Guest Adventurer',
            authorEmail: normalizeEmail(thread.authorEmail),
            authorAvatar: cleanText(thread.authorAvatar, 1000),
            createdAt: Number(thread.createdAt) || Date.now(),
            isPinned: Boolean(thread.isPinned),
            isLocked: Boolean(thread.isLocked)
          };
        }).filter(Boolean)
      : [];
    const threadIds = new Set(threads.map((thread) => thread.id));
    const replies = Array.isArray(sourceSpace.replies)
      ? sourceSpace.replies.map((reply) => {
          const body = cleanText(reply && reply.body, 6000);
          const threadId = cleanText(reply && reply.threadId, 160);
          if (!body || !threadIds.has(threadId)) {
            return null;
          }
          return {
            id: cleanText(reply.id, 160) || buildId(`${spaceKey}-reply`),
            threadId,
            parentReplyId: cleanText(reply.parentReplyId, 160) || null,
            body,
            linkUrl: cleanForumUrl(reply.linkUrl),
            imageUrl: cleanForumImage(reply.imageUrl),
            authorName: cleanText(reply.authorName, 100) || 'Guest Adventurer',
            authorEmail: normalizeEmail(reply.authorEmail),
            authorAvatar: cleanText(reply.authorAvatar, 1000),
            createdAt: Number(reply.createdAt) || Date.now()
          };
        }).filter(Boolean)
      : [];
    fallback[spaceKey] = { categories: normalizedCategories, threads, replies };
  });
  return fallback;
}

async function migrateLegacyForumState(store) {
  const legacy = await readJson(store, FORUM_KEY, { state: null, updatedAt: '' });
  const state = normalizeForumState(legacy.state);
  const hasLegacyPosts = state.public.threads.length || state.public.replies.length ||
    state.private.threads.length || state.private.replies.length;
  const config = await readJson(store, FORUM_CONFIG_KEY, null);

  if (hasLegacyPosts) {
    const writes = [];
    ['public', 'private'].forEach((spaceKey) => {
      state[spaceKey].threads.forEach((thread) => {
        writes.push(store.setJSON(`${FORUM_THREAD_PREFIX}${spaceKey}/${thread.id}`, { ...thread, space: spaceKey }));
      });
      state[spaceKey].replies.forEach((reply) => {
        writes.push(store.setJSON(`${FORUM_REPLY_PREFIX}${spaceKey}/${reply.id}`, { ...reply, space: spaceKey }));
      });
    });
    await Promise.all(writes);
  }

  if (!config) {
    await store.setJSON(FORUM_CONFIG_KEY, {
      public: { categories: state.public.categories },
      private: { categories: state.private.categories },
      updatedAt: legacy.updatedAt || new Date().toISOString()
    });
  }

  if (hasLegacyPosts) {
    await store.setJSON(FORUM_KEY, {
      state: {
        public: { categories: state.public.categories, threads: [], replies: [] },
        private: { categories: state.private.categories, threads: [], replies: [] }
      },
      updatedAt: new Date().toISOString()
    });
  }
}

async function loadForumState(store) {
  await migrateLegacyForumState(store);
  const [config, threads, replies] = await Promise.all([
    readJson(store, FORUM_CONFIG_KEY, null),
    readBlobCollection(store, FORUM_THREAD_PREFIX),
    readBlobCollection(store, FORUM_REPLY_PREFIX)
  ]);
  const state = normalizeForumState({
    public: {
      categories: config && config.public && config.public.categories,
      threads: threads.filter((thread) => thread.space === 'public'),
      replies: replies.filter((reply) => reply.space === 'public')
    },
    private: {
      categories: config && config.private && config.private.categories,
      threads: threads.filter((thread) => thread.space === 'private'),
      replies: replies.filter((reply) => reply.space === 'private')
    }
  });
  return {
    state,
    updatedAt: (config && config.updatedAt) || ''
  };
}

async function saveForumCategories(store, state) {
  const updatedAt = new Date().toISOString();
  await store.setJSON(FORUM_CONFIG_KEY, {
    public: { categories: state.public.categories },
    private: { categories: state.private.categories },
    updatedAt
  });
  return updatedAt;
}

async function getForumRole(store, email) {
  if (!email) {
    return 'public';
  }
  if (email === OWNER_EMAIL) {
    return 'moderator';
  }
  const payload = await readJson(store, KV_KEY, { items: {} });
  const rawDirectory = payload.items && payload.items[DIRECTORY_KEY];
  if (typeof rawDirectory !== 'string') {
    return 'public';
  }
  let directory;
  try {
    directory = JSON.parse(rawDirectory);
  } catch (error) {
    return 'public';
  }
  const members = Array.isArray(directory && directory.members) ? directory.members : [];
  const member = members.find((candidate) => normalizeEmail(candidate && candidate.email) === email);
  if (
    !member ||
    !ACTIVE_MEMBER_STATUSES.has(cleanText(member.status, 40).toLowerCase()) ||
    !member.access ||
    member.access.forums !== true
  ) {
    return 'public';
  }
  return member.access.moderateForums === true ? 'moderator' : 'member';
}

function forumPayloadForRole(state, role, updatedAt) {
  const normalized = normalizeForumState(state);
  return {
    state: role === 'member' || role === 'moderator'
      ? normalized
      : { public: normalized.public, private: defaultForumState().private },
    updatedAt: updatedAt || '',
    access: role
  };
}

function forumAuthor(context, body) {
  const user = getRequestUser(context);
  const email = normalizeEmail(user && user.email);
  const metadata = user && user.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {};
  return {
    authorName: cleanText(metadata.full_name || body.authorName, 100) || (email ? email.split('@')[0] : 'Guest Adventurer'),
    authorEmail: email,
    authorAvatar: cleanText(metadata.avatar_url || body.authorAvatar, 1000)
  };
}

function normalizeNewsPost(post, index, total) {
  if (!post || typeof post !== 'object') {
    return null;
  }

  const title = String(post.title || '').trim();
  const body = String(post.body || '').trim();
  if (!title || !body) {
    return null;
  }

  const createdAt = Number(post.createdAt) || Number(post.updatedAt) || Math.max(0, total - index);
  const updatedAt = Number(post.updatedAt) || createdAt;

  return {
    id: String(post.id || '').trim() || `news-${createdAt}-${index}`,
    title,
    body,
    author: String(post.author || post.authorName || 'Guild Member'),
    avatar: String(post.avatar || post.authorAvatar || ''),
    createdAt,
    updatedAt,
    postedToForum: Boolean(post.postedToForum),
    forumThreadId: typeof post.forumThreadId === 'string' ? post.forumThreadId : ''
  };
}

function normalizeNewsPosts(posts) {
  if (!Array.isArray(posts)) {
    return [];
  }

  return posts
    .map((post, index, all) => normalizeNewsPost(post, index, all.length))
    .filter(Boolean)
    .sort((left, right) => (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0));
}

exports.handler = async function handler(event, context) {
  const scope = readScope(event);
  if (!scope) {
    return json(400, { error: 'Invalid scope.' });
  }

  connectLambda(event);
  const store = getStore(STORE_NAME);

  if (event.httpMethod === 'GET') {
    if (scope === 'news') {
      const payload = await readJson(store, NEWS_KEY, { posts: [], updatedAt: '' });
      return json(200, {
        posts: normalizeNewsPosts(payload.posts),
        updatedAt: payload.updatedAt || ''
      });
    }
    if (scope === 'kv') {
      const payload = await readJson(store, KV_KEY, { items: {}, updatedAt: '' });
      const items = payload.items && typeof payload.items === 'object' ? payload.items : {};
      const filteredItems = {};
      const email = getRequestEmail(context);
      Object.keys(items).forEach((key) => {
        if (!isValidKvKey(key) || typeof items[key] !== 'string') {
          return;
        }
        if (key === DIRECTORY_KEY) {
          if (!email) {
            return;
          }
          if (email === OWNER_EMAIL) {
            filteredItems[key] = items[key];
            return;
          }
          try {
            const directory = JSON.parse(items[key]);
            const members = Array.isArray(directory && directory.members) ? directory.members : [];
            const member = members.find((candidate) => normalizeEmail(candidate && candidate.email) === email);
            if (member) {
              filteredItems[key] = JSON.stringify({
                version: directory.version || 1,
                updatedAt: directory.updatedAt || '',
                members: [{
                  id: member.id,
                  email: member.email,
                  name: member.name,
                  title: member.title,
                  level: member.level,
                  status: member.status,
                  verifiedNetlify: Boolean(member.verifiedNetlify),
                  access: member.access
                }]
              });
            }
          } catch (error) {
            return;
          }
        } else {
          filteredItems[key] = items[key];
        }
      });
      return json(200, { items: filteredItems, updatedAt: payload.updatedAt || '' });
    }
    const payload = await loadForumState(store);
    const role = await getForumRole(store, getRequestEmail(context));
    return json(200, forumPayloadForRole(payload.state, role, payload.updatedAt));
  }

  if (event.httpMethod !== 'PUT' && event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed.' });
  }

  const email = getRequestEmail(context);
  if (!email && (scope !== 'forum' || event.httpMethod !== 'POST')) {
    return json(401, { error: 'Authentication required.' });
  }

  let body = null;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch (error) {
    return json(400, { error: 'Invalid JSON body.' });
  }

  if (scope === 'news') {
    if (email !== OWNER_EMAIL) {
      return json(403, { error: 'Only the owner can update news posts.' });
    }
    if (!Array.isArray(body.posts)) {
      return json(400, { error: 'Expected `posts` to be an array.' });
    }
    const posts = normalizeNewsPosts(body.posts);
    const payload = {
      posts,
      updatedAt: new Date().toISOString()
    };
    await store.setJSON(NEWS_KEY, payload);
    return json(200, payload);
  }

  if (scope === 'kv') {
    const existing = await readJson(store, KV_KEY, { items: {}, updatedAt: '' });
    const existingItems = existing.items && typeof existing.items === 'object' ? existing.items : {};
    if (!body.items || typeof body.items !== 'object') {
      return json(400, { error: 'Expected `items` to be an object.' });
    }
    const nextItems = { ...existingItems };
    Object.keys(body.items).forEach((key) => {
      if (!isValidKvKey(key)) {
        return;
      }
      if (key === DIRECTORY_KEY && email !== OWNER_EMAIL) {
        return;
      }
      const nextValue = body.items[key];
      if (nextValue === null) {
        delete nextItems[key];
      } else if (typeof nextValue === 'string') {
        nextItems[key] = nextValue;
      }
    });
    const payload = {
      items: nextItems,
      updatedAt: new Date().toISOString()
    };
    await store.setJSON(KV_KEY, payload);
    return json(200, payload);
  }

  const existing = await loadForumState(store);
  const state = existing.state;
  const role = await getForumRole(store, email);

  if (event.httpMethod === 'POST') {
    const action = cleanText(body.action, 40);
    const spaceKey = body.space === 'private' ? 'private' : 'public';
    if (spaceKey === 'private' && role !== 'member' && role !== 'moderator') {
      return json(403, { error: 'Authorized member forum access is required.' });
    }
    const author = forumAuthor(context, body);

    if (action === 'create-thread') {
      const title = cleanText(body.title, 180);
      const threadBody = cleanText(body.body, 12000);
      const requestedLinkUrl = cleanText(body.linkUrl, 2001);
      const requestedImageUrl = String(body.imageUrl || '').trim();
      if (!title || !threadBody) {
        return json(400, { error: 'A thread title and message are required.' });
      }
      if ((requestedLinkUrl || requestedImageUrl) && !email) {
        return json(403, { error: 'Sign in to attach hyperlinks or images.' });
      }
      const linkUrl = cleanForumUrl(requestedLinkUrl);
      const imageUrl = cleanForumImage(requestedImageUrl);
      if ((requestedLinkUrl && !linkUrl) || (requestedImageUrl && !imageUrl)) {
        return json(400, { error: 'Use a valid HTTP/HTTPS hyperlink and a supported forum image.' });
      }
      const categories = state[spaceKey].categories;
      const categoryId = categories.some((category) => category.id === body.categoryId)
        ? body.categoryId
        : categories[0].id;
      const thread = {
        id: buildId(`${spaceKey}-thread`),
        categoryId,
        title,
        body: threadBody,
        linkUrl,
        imageUrl,
        ...author,
        createdAt: Date.now(),
        isPinned: false,
        isLocked: false,
        space: spaceKey
      };
      await store.setJSON(`${FORUM_THREAD_PREFIX}${spaceKey}/${thread.id}`, thread);
      state[spaceKey].threads.push(thread);
    } else if (action === 'create-reply') {
      const replyBody = cleanText(body.body, 6000);
      const requestedLinkUrl = cleanText(body.linkUrl, 2001);
      const requestedImageUrl = String(body.imageUrl || '').trim();
      const threadId = cleanText(body.threadId, 160);
      const thread = state[spaceKey].threads.find((candidate) => candidate.id === threadId);
      if (!thread) {
        return json(404, { error: 'Forum thread not found.' });
      }
      if (thread.isLocked) {
        return json(409, { error: 'This thread is locked.' });
      }
      if (!replyBody) {
        return json(400, { error: 'A reply message is required.' });
      }
      if ((requestedLinkUrl || requestedImageUrl) && !email) {
        return json(403, { error: 'Sign in to attach hyperlinks or images.' });
      }
      const linkUrl = cleanForumUrl(requestedLinkUrl);
      const imageUrl = cleanForumImage(requestedImageUrl);
      if ((requestedLinkUrl && !linkUrl) || (requestedImageUrl && !imageUrl)) {
        return json(400, { error: 'Use a valid HTTP/HTTPS hyperlink and a supported forum image.' });
      }
      const parentReplyId = cleanText(body.parentReplyId, 160);
      const parentReply = parentReplyId
        ? state[spaceKey].replies.find((reply) => reply.id === parentReplyId && reply.threadId === threadId)
        : null;
      const reply = {
        id: buildId(`${spaceKey}-reply`),
        threadId,
        parentReplyId: parentReply ? parentReply.id : null,
        body: replyBody,
        linkUrl,
        imageUrl,
        ...author,
        createdAt: Date.now(),
        space: spaceKey
      };
      await store.setJSON(`${FORUM_REPLY_PREFIX}${spaceKey}/${reply.id}`, reply);
      state[spaceKey].replies.push(reply);
    } else if (
      action === 'create-category' ||
      action === 'rename-category' ||
      action === 'delete-category' ||
      action === 'toggle-pin' ||
      action === 'toggle-lock' ||
      action === 'delete-thread' ||
      action === 'delete-reply'
    ) {
      if (role !== 'moderator') {
        return json(403, { error: 'Forum moderator access is required.' });
      }
      if (action === 'create-category') {
        const name = cleanText(body.name, 80);
        const description = cleanText(body.description, 240);
        if (!name || !description) {
          return json(400, { error: 'A category name and description are required.' });
        }
        state[spaceKey].categories.push({
          id: buildId(`${spaceKey}-category`),
          name,
          description
        });
        await saveForumCategories(store, state);
      } else if (action === 'rename-category') {
        const category = state[spaceKey].categories.find((candidate) => candidate.id === body.categoryId);
        const name = cleanText(body.name, 80);
        const description = cleanText(body.description, 240);
        if (!category) {
          return json(404, { error: 'Forum category not found.' });
        }
        if (!name || !description) {
          return json(400, { error: 'A category name and description are required.' });
        }
        category.name = name;
        category.description = description;
        await saveForumCategories(store, state);
      } else if (action === 'delete-category') {
        const categories = state[spaceKey].categories;
        if (categories.length <= 1) {
          return json(409, { error: 'At least one category is required.' });
        }
        const categoryIndex = categories.findIndex((category) => category.id === body.categoryId);
        if (categoryIndex < 0) {
          return json(404, { error: 'Forum category not found.' });
        }
        categories.splice(categoryIndex, 1);
        const fallbackCategoryId = categories[0].id;
        const affectedThreads = state[spaceKey].threads.filter((thread) => thread.categoryId === body.categoryId);
        await Promise.all(affectedThreads.map((thread) => {
          thread.categoryId = fallbackCategoryId;
          return store.setJSON(`${FORUM_THREAD_PREFIX}${spaceKey}/${thread.id}`, { ...thread, space: spaceKey });
        }));
        await saveForumCategories(store, state);
      } else if (action === 'toggle-pin' || action === 'toggle-lock') {
        const thread = state[spaceKey].threads.find((candidate) => candidate.id === body.threadId);
        if (!thread) {
          return json(404, { error: 'Forum thread not found.' });
        }
        if (action === 'toggle-pin') {
          thread.isPinned = !thread.isPinned;
        } else {
          thread.isLocked = !thread.isLocked;
        }
        await store.setJSON(`${FORUM_THREAD_PREFIX}${spaceKey}/${thread.id}`, { ...thread, space: spaceKey });
      } else if (action === 'delete-thread') {
        const threadId = cleanText(body.threadId, 160);
        const thread = state[spaceKey].threads.find((candidate) => candidate.id === threadId);
        if (!thread) {
          return json(404, { error: 'Forum thread not found.' });
        }
        const replies = state[spaceKey].replies.filter((reply) => reply.threadId === threadId);
        await Promise.all([
          store.delete(`${FORUM_THREAD_PREFIX}${spaceKey}/${threadId}`),
          ...replies.map((reply) => store.delete(`${FORUM_REPLY_PREFIX}${spaceKey}/${reply.id}`))
        ]);
        state[spaceKey].threads = state[spaceKey].threads.filter((candidate) => candidate.id !== threadId);
        state[spaceKey].replies = state[spaceKey].replies.filter((reply) => reply.threadId !== threadId);
      } else if (action === 'delete-reply') {
        const replyId = cleanText(body.replyId, 160);
        const toRemove = new Set([replyId]);
        let found = state[spaceKey].replies.some((reply) => reply.id === replyId);
        if (!found) {
          return json(404, { error: 'Forum reply not found.' });
        }
        let changed = true;
        while (changed) {
          changed = false;
          state[spaceKey].replies.forEach((reply) => {
            if (reply.parentReplyId && toRemove.has(reply.parentReplyId) && !toRemove.has(reply.id)) {
              toRemove.add(reply.id);
              changed = true;
            }
          });
        }
        await Promise.all([...toRemove].map((id) => store.delete(`${FORUM_REPLY_PREFIX}${spaceKey}/${id}`)));
        state[spaceKey].replies = state[spaceKey].replies.filter((reply) => !toRemove.has(reply.id));
      }
    } else {
      return json(400, { error: 'Unsupported forum action.' });
    }

    const updatedAt = new Date().toISOString();
    return json(200, forumPayloadForRole(state, role, updatedAt));
  }

  return json(405, { error: 'Use targeted forum operations.' });
};
