const { getStore } = require('@netlify/blobs');

const OWNER_EMAIL = 'ojmac79@gmail.com';
const STORE_NAME = 'the-chosen-content';
const NEWS_KEY = 'news-posts-v1';
const FORUM_KEY = 'forum-state-v1';
const KV_KEY = 'kv-state-v1';

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

async function readJson(store, key, fallback) {
  const value = await store.get(key, { type: 'json' });
  if (!value || typeof value !== 'object') {
    return fallback;
  }
  return value;
}

function isValidKvKey(key) {
  return typeof key === 'string' && key.startsWith('theChosen');
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
      Object.keys(items).forEach((key) => {
        if (isValidKvKey(key) && typeof items[key] === 'string') {
          filteredItems[key] = items[key];
        }
      });
      return json(200, { items: filteredItems, updatedAt: payload.updatedAt || '' });
    }
    const payload = await readJson(store, FORUM_KEY, { state: null, updatedAt: '' });
    return json(200, payload);
  }

  if (event.httpMethod !== 'PUT') {
    return json(405, { error: 'Method not allowed.' });
  }

  const email = getRequestEmail(context);
  if (!email) {
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
  if (!body.state || typeof body.state !== 'object') {
    return json(400, { error: 'Expected `state` to be an object.' });
  }
  const payload = {
    state: body.state,
    updatedAt: new Date().toISOString()
  };
  await store.setJSON(FORUM_KEY, payload);
  return json(200, payload);
};
