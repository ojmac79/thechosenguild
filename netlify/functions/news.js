const { connectLambda, getStore } = require('@netlify/blobs');

const OWNER_EMAIL = 'ojmac79@gmail.com';
const STORE_NAME = 'the-chosen-content';
const NEWS_KEY = 'news-posts-v1';
const FORUM_KEY = 'forum-state-v1';
const FORUM_CONFIG_KEY = 'forum-config-v1';
const FORUM_THREAD_PREFIX = 'forum-threads/';
const PUBLIC_FORUM_CATEGORY = 'pub-general';

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

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
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
    authorEmail: cleanText(post.authorEmail, 254).toLowerCase(),
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
    authorEmail: post.authorEmail,
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

  if (requestEmail(context) !== OWNER_EMAIL) {
    return json(403, { error: 'Only the site owner can publish news.' });
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

  const payload = await readJson(store, NEWS_KEY, { posts: [], updatedAt: '' });
  const posts = normalizePosts(payload.posts);
  const now = Date.now();
  let post;

  if (event.httpMethod === 'PUT') {
    const postId = cleanText(body.id, 160);
    const index = posts.findIndex((candidate) => candidate.id === postId);
    if (index < 0) {
      return json(404, { error: 'News article not found.' });
    }
    post = {
      ...posts[index],
      title,
      body: postBody,
      authorName: cleanText(body.authorName, 100) || posts[index].authorName || 'Guild Leader',
      authorEmail: OWNER_EMAIL,
      authorAvatar: cleanText(body.authorAvatar, 1000),
      updatedAt: now
    };
    posts[index] = post;
  } else {
    post = {
      id: buildId('news'),
      title,
      body: postBody,
      authorName: cleanText(body.authorName, 100) || 'Guild Leader',
      authorEmail: OWNER_EMAIL,
      authorAvatar: cleanText(body.authorAvatar, 1000),
      createdAt: now,
      updatedAt: now,
      postedToForum: false,
      forumThreadId: ''
    };
    posts.unshift(post);
  }

  let nextPosts = normalizePosts(posts);
  let nextPayload = {
    posts: nextPosts,
    updatedAt: new Date().toISOString()
  };
  await store.setJSON(NEWS_KEY, nextPayload);

  let forumCopied = false;
  let forumWarning = '';
  if (body.postToForum) {
    try {
      post.forumThreadId = await mirrorToPublicForum(store, post);
      post.postedToForum = true;
      nextPosts = normalizePosts(posts);
      nextPayload = {
        posts: nextPosts,
        updatedAt: new Date().toISOString()
      };
      await store.setJSON(NEWS_KEY, nextPayload);
      forumCopied = true;
    } catch (error) {
      forumWarning = 'News was saved, but the public forum copy failed.';
    }
  }

  return json(200, {
    post,
    posts: nextPosts,
    updatedAt: nextPayload.updatedAt,
    forumCopied,
    forumWarning
  });
};
