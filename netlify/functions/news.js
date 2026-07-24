const { connectLambda, getStore } = require('@netlify/blobs');

const OWNER_EMAIL = 'ojmac79@gmail.com';
const STORE_NAME = 'the-chosen-content';
const NEWS_KEY = 'news-posts-v1';
const FORUM_KEY = 'forum-state-v1';
const FORUM_CONFIG_KEY = 'forum-config-v1';
const FORUM_THREAD_PREFIX = 'forum-threads/';
const PUBLIC_FORUM_CATEGORY = 'pub-general';
const KV_KEY = 'kv-state-v1';
const DIRECTORY_KEY = 'theChosenGuildDirectoryV1';
const ACTIVE_MEMBER_STATUSES = new Set(['active', 'probation']);

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

function requestEmail(context) {
  const user = context && context.clientContext && context.clientContext.user;
  return String((user && user.email) || '').trim().toLowerCase();
}

async function readJson(store, key, fallback) {
  const value = await store.get(key, { type: 'json' });
  return value && typeof value === 'object' ? value : fallback;
}

async function updateJsonAtomically(store, key, fallback, update) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const entry = await store.getWithMetadata(key, { type: 'json' });
    const current = entry && entry.data && typeof entry.data === 'object' ? entry.data : fallback;
    const next = update(current);
    if (!next) {
      return current;
    }
    if (entry && !entry.etag) {
      throw new Error(`Cannot safely update ${key} without an ETag.`);
    }
    const condition = entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true };
    // setJSON in @netlify/blobs 10.7.9 drops conditional-write options.
    const result = await store.set(key, JSON.stringify(next), condition);
    if (result.modified) {
      return next;
    }
  }
  throw new Error(`Could not update ${key} because concurrent changes did not settle.`);
}

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

async function isAuthorizedEditor(store, email) {
  if (email === OWNER_EMAIL) {
    return true;
  }
  const payload = await readJson(store, KV_KEY, { items: {} });
  const rawDirectory = payload.items && payload.items[DIRECTORY_KEY];
  if (typeof rawDirectory !== 'string') {
    return false;
  }
  try {
    const directory = JSON.parse(rawDirectory);
    const members = Array.isArray(directory && directory.members) ? directory.members : [];
    const member = members.find(
      (candidate) => String(candidate && candidate.email || '').trim().toLowerCase() === email
    );
    return Boolean(member && ACTIVE_MEMBER_STATUSES.has(cleanText(member.status, 40).toLowerCase()));
  } catch (error) {
    return false;
  }
}

function normalizePost(post, index, total) {
  if (!post || typeof post !== 'object') {
    return null;
  }

  const title = cleanText(post.title, 180);
  const body = cleanText(post.body, 12000);
  if (!title || !body) {
    return null;
  }

  const createdAt = Number(post.createdAt) || Number(post.updatedAt) || Math.max(1, total - index);
  return {
    id: cleanText(post.id, 160) || `news-${createdAt}-${index}`,
    title,
    body,
    authorName: cleanText(post.authorName || post.author, 100) || 'Guild Leader',
    authorAvatar: cleanText(post.authorAvatar || post.avatar, 1000),
    createdAt,
    updatedAt: Number(post.updatedAt) || createdAt,
    postedToForum: Boolean(post.postedToForum),
    forumThreadId: cleanText(post.forumThreadId, 160)
  };
}

function normalizePosts(posts) {
  if (!Array.isArray(posts)) {
    return [];
  }

  return posts
    .map((post, index, all) => normalizePost(post, index, all.length))
    .filter(Boolean)
    .sort((left, right) => {
      const createdDelta = right.createdAt - left.createdAt;
      return createdDelta || right.updatedAt - left.updatedAt;
    });
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
  if (!source || typeof source !== 'object') {
    return fallback;
  }

  return {
    public: {
      categories: Array.isArray(source.public && source.public.categories) && source.public.categories.length
        ? source.public.categories
        : fallback.public.categories,
      threads: Array.isArray(source.public && source.public.threads) ? source.public.threads : [],
      replies: Array.isArray(source.public && source.public.replies) ? source.public.replies : []
    },
    private: {
      categories: Array.isArray(source.private && source.private.categories) && source.private.categories.length
        ? source.private.categories
        : fallback.private.categories,
      threads: Array.isArray(source.private && source.private.threads) ? source.private.threads : [],
      replies: Array.isArray(source.private && source.private.replies) ? source.private.replies : []
    }
  };
}

function buildId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

async function mirrorToPublicForum(store, post) {
  const [legacyPayload, config] = await Promise.all([
    readJson(store, FORUM_KEY, { state: null, updatedAt: '' }),
    readJson(store, FORUM_CONFIG_KEY, null)
  ]);
  const legacyState = normalizeForumState(legacyPayload.state);
  const publicCategories = Array.isArray(config && config.public && config.public.categories) && config.public.categories.length
    ? config.public.categories
    : legacyState.public.categories;
  const categoryId = publicCategories.some((category) => category.id === PUBLIC_FORUM_CATEGORY)
    ? PUBLIC_FORUM_CATEGORY
    : publicCategories[0].id;
  const threadId = post.forumThreadId || buildId('public-thread');
  const existing = await readJson(
    store,
    `${FORUM_THREAD_PREFIX}public/${threadId}`,
    legacyState.public.threads.find((thread) => String(thread.id || '') === threadId) || null
  );
  const thread = {
    ...(existing || {}),
    id: threadId,
    categoryId,
    title: post.title,
    body: post.body,
    authorName: post.authorName,
    authorAvatar: post.authorAvatar,
    createdAt: existing ? Number(existing.createdAt) || post.createdAt : post.createdAt,
    isPinned: existing ? Boolean(existing.isPinned) : false,
    isLocked: existing ? Boolean(existing.isLocked) : false,
    space: 'public'
  };

  await store.setJSON(`${FORUM_THREAD_PREFIX}public/${threadId}`, thread);
  return threadId;
}

exports.handler = async function handler(event, context) {
  connectLambda(event);
  const store = getStore(STORE_NAME);

  if (event.httpMethod === 'GET') {
    const payload = await readJson(store, NEWS_KEY, { posts: [], updatedAt: '' });
    return json(200, {
      posts: normalizePosts(payload.posts),
      updatedAt: payload.updatedAt || ''
    });
  }

  if (event.httpMethod !== 'POST' && event.httpMethod !== 'PUT') {
    return json(405, { error: 'Method not allowed.' });
  }

  const editorEmail = requestEmail(context);
  if (!(await isAuthorizedEditor(store, editorEmail))) {
    return json(403, { error: 'An approved guild account is required to publish news.' });
  }

  let body;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch (error) {
    return json(400, { error: 'Invalid JSON body.' });
  }

  const title = cleanText(body.title, 180);
  const postBody = cleanText(body.body, 12000);
  if (!title || !postBody) {
    return json(400, { error: 'A title and message are required.' });
  }

  const now = Date.now();
  const postId = event.httpMethod === 'PUT' ? cleanText(body.id, 160) : buildId('news');
  let post = null;
  let postMissing = false;
  let nextPayload = await updateJsonAtomically(store, NEWS_KEY, { posts: [], updatedAt: '' }, (payload) => {
    const posts = normalizePosts(payload.posts);
    if (event.httpMethod === 'PUT') {
      const index = posts.findIndex((candidate) => candidate.id === postId);
      if (index < 0) {
        postMissing = true;
        return null;
      }
      post = {
        ...posts[index],
        title,
        body: postBody,
        authorName: cleanText(body.authorName, 100) || posts[index].authorName || 'Guild Leader',
        authorAvatar: cleanText(body.authorAvatar, 1000),
        updatedAt: now
      };
      posts[index] = post;
    } else {
      post = {
        id: postId,
        title,
        body: postBody,
        authorName: cleanText(body.authorName, 100) || 'Guild Leader',
        authorAvatar: cleanText(body.authorAvatar, 1000),
        createdAt: now,
        updatedAt: now,
        postedToForum: false,
        forumThreadId: ''
      };
      posts.unshift(post);
    }
    return {
      posts: normalizePosts(posts),
      updatedAt: new Date().toISOString()
    };
  });
  if (postMissing) {
    return json(404, { error: 'News article not found.' });
  }

  let forumCopied = false;
  let forumWarning = '';
  if (body.postToForum) {
    try {
      const forumThreadId = await mirrorToPublicForum(store, post);
      nextPayload = await updateJsonAtomically(store, NEWS_KEY, { posts: [], updatedAt: '' }, (payload) => {
        const posts = normalizePosts(payload.posts);
        const index = posts.findIndex((candidate) => candidate.id === postId);
        if (index < 0) {
          return null;
        }
        post = {
          ...posts[index],
          postedToForum: true,
          forumThreadId
        };
        posts[index] = post;
        return {
          posts: normalizePosts(posts),
          updatedAt: new Date().toISOString()
        };
      });
      forumCopied = true;
    } catch (error) {
      forumWarning = 'News was saved, but the public forum copy failed.';
    }
  }

  return json(200, {
    post,
    posts: normalizePosts(nextPayload.posts),
    updatedAt: nextPayload.updatedAt,
    forumCopied,
    forumWarning
  });
};
