(function () {
  const PREFIX = 'theChosen';
  const NEWS_STORAGE_KEY = 'theChosenNewsPosts';
  const ENDPOINT = '/.netlify/functions/content-state?scope=kv';
  const storage = window.localStorage;
  if (!storage) {
    return;
  }

  const originalGetItem = storage.getItem.bind(storage);
  const originalSetItem = storage.setItem.bind(storage);
  const originalRemoveItem = storage.removeItem.bind(storage);
  const originalKey = storage.key.bind(storage);

  const cache = {};
  let initialized = false;
  let flushTimer = null;
  const pending = {};

  function isScopedKey(key) {
    return typeof key === 'string' && key.indexOf(PREFIX) === 0 && key !== NEWS_STORAGE_KEY;
  }

  function snapshotNativeScopedEntries() {
    const output = {};
    const total = storage.length;
    for (let i = 0; i < total; i += 1) {
      const key = originalKey(i);
      if (!isScopedKey(key)) {
        continue;
      }
      const value = originalGetItem(key);
      if (typeof value === 'string') {
        output[key] = value;
      }
    }
    return output;
  }

  function emitStorageChange(key) {
    try {
      window.dispatchEvent(new StorageEvent('storage', { key: key, storageArea: storage }));
    } catch (error) {
      const fallbackEvent = new Event('storage');
      fallbackEvent.key = key;
      window.dispatchEvent(fallbackEvent);
    }
  }

  function queueFlush() {
    if (flushTimer) {
      window.clearTimeout(flushTimer);
    }
    flushTimer = window.setTimeout(function () {
      flushTimer = null;
      void flushPending();
    }, 250);
  }

  async function getIdentityToken() {
    if (!window.netlifyIdentity || typeof window.netlifyIdentity.currentUser !== 'function') {
      return '';
    }
    const user = window.netlifyIdentity.currentUser();
    if (!user || typeof user.jwt !== 'function') {
      return '';
    }
    try {
      return await user.jwt();
    } catch (error) {
      return '';
    }
  }

  async function flushPending() {
    const keys = Object.keys(pending);
    if (!keys.length) {
      return;
    }
    const token = await getIdentityToken();
    if (!token) {
      window.setTimeout(function () {
        void flushPending();
      }, 5000);
      return;
    }
    const items = {};
    keys.forEach(function (key) {
      items[key] = pending[key];
    });
    const response = await fetch(ENDPOINT, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      body: JSON.stringify({ items: items })
    });
    if (!response.ok) {
      return;
    }
    keys.forEach(function (key) {
      delete pending[key];
    });
  }

  function setScopedValue(key, value) {
    const nextValue = typeof value === 'string' ? value : String(value);
    const previous = Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : null;
    cache[key] = nextValue;
    pending[key] = nextValue;
    queueFlush();
    if (previous !== nextValue) {
      emitStorageChange(key);
    }
  }

  function removeScopedValue(key) {
    if (Object.prototype.hasOwnProperty.call(cache, key)) {
      delete cache[key];
      pending[key] = null;
      queueFlush();
      emitStorageChange(key);
    }
  }

  function patchStorage() {
    storage.getItem = function patchedGetItem(key) {
      if (isScopedKey(key)) {
        return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : null;
      }
      return originalGetItem(key);
    };

    storage.setItem = function patchedSetItem(key, value) {
      if (isScopedKey(key)) {
        setScopedValue(key, value);
        return;
      }
      originalSetItem(key, value);
    };

    storage.removeItem = function patchedRemoveItem(key) {
      if (isScopedKey(key)) {
        removeScopedValue(key);
        return;
      }
      originalRemoveItem(key);
    };

  }

  async function hydrate() {
    const nativeEntries = snapshotNativeScopedEntries();
    Object.keys(nativeEntries).forEach(function (key) {
      cache[key] = nativeEntries[key];
    });

    try {
      const response = await fetch(ENDPOINT, { credentials: 'same-origin' });
      if (response.ok) {
        const payload = await response.json();
        const items = payload && payload.items && typeof payload.items === 'object' ? payload.items : {};
        const remoteKeys = Object.keys(items).filter(function (key) {
          return isScopedKey(key) && typeof items[key] === 'string';
        });

        if (remoteKeys.length) {
          const previousEntries = { ...cache };
          Object.keys(cache).forEach(function (key) {
            delete cache[key];
          });
          remoteKeys.forEach(function (key) {
            cache[key] = items[key];
          });
          Object.keys({ ...previousEntries, ...cache }).forEach(function (key) {
            if (previousEntries[key] !== cache[key]) {
              emitStorageChange(key);
            }
          });
        } else if (Object.keys(nativeEntries).length) {
          Object.keys(nativeEntries).forEach(function (key) {
            pending[key] = nativeEntries[key];
          });
          queueFlush();
        }
      }
    } catch (error) {
      // Keep in-memory cache if remote is unavailable.
    }

    Object.keys(nativeEntries).forEach(function (key) {
      originalRemoveItem(key);
    });
    initialized = true;
    window.dispatchEvent(new CustomEvent('theChosen:persistent-store-ready'));
  }

  patchStorage();
  void hydrate();

  if (window.netlifyIdentity && typeof window.netlifyIdentity.on === 'function') {
    window.netlifyIdentity.on('login', function () {
      if (initialized) {
        queueFlush();
      }
    });
  }
})();
