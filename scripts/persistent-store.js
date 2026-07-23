(function () {
  const PREFIX = 'theChosen';
  const NEWS_STORAGE_KEY = 'theChosenNewsPosts';
  const DIRECTORY_STORAGE_KEY = 'theChosenGuildDirectoryV1';
  const LOCAL_ONLY_KEYS = new Set([
    NEWS_STORAGE_KEY,
    'theChosenCurrentMember',
    'theChosenForumStateV2',
    'theChosenMemberAvatarsV1'
  ]);
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
  let flushPromise = null;
  let hydratePromise = null;
  let hydrateQueued = false;
  let hydrationRetryTimer = null;
  let retryTimer = null;
  const pending = {};
  const pendingVersions = {};
  const versions = {};

  function isScopedKey(key) {
    return typeof key === 'string' && key.indexOf(PREFIX) === 0 && !LOCAL_ONLY_KEYS.has(key);
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

  function scheduleRetry() {
    if (retryTimer) {
      return;
    }
    retryTimer = window.setTimeout(function () {
      retryTimer = null;
      void flushPending();
    }, 5000);
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
    if (flushPromise) {
      return flushPromise;
    }
    flushPromise = (async function () {
      while (Object.keys(pending).length) {
        const token = await getIdentityToken();
        if (!token) {
          scheduleRetry();
          return;
        }
        const keys = Object.keys(pending);
        const items = {};
        const submittedVersions = {};
        keys.forEach(function (key) {
          items[key] = pending[key];
          submittedVersions[key] = Number(pendingVersions[key]) || 0;
        });
        let response;
        try {
          response = await fetch(ENDPOINT, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + token
            },
            body: JSON.stringify({ items: items, versions: submittedVersions })
          });
        } catch (error) {
          console.error('Persistent site content sync failed:', error);
          scheduleRetry();
          return;
        }
        if (!response.ok) {
          if (response.status === 409) {
            const payload = await response.json();
            const conflicts = Array.isArray(payload && payload.conflicts) ? payload.conflicts : [];
            const latestItems = payload && payload.items && typeof payload.items === 'object' ? payload.items : {};
            const latestVersions = payload && payload.versions && typeof payload.versions === 'object'
              ? payload.versions
              : {};
            conflicts.forEach(function (key) {
              const changedWhileSaving = pending[key] !== items[key];
              const keepLocal = changedWhileSaving && window.confirm(
                'This content changed on the server while you were editing. Select OK to keep and resubmit your local changes, or Cancel to load the server version.'
              );
              if (keepLocal) {
                pendingVersions[key] = Number(latestVersions[key]) || 0;
                return;
              }
              delete pending[key];
              delete pendingVersions[key];
              if (typeof latestItems[key] === 'string') {
                cache[key] = latestItems[key];
              } else {
                delete cache[key];
              }
              versions[key] = Number(latestVersions[key]) || 0;
              originalRemoveItem(key);
              emitStorageChange(key);
            });
            window.dispatchEvent(new CustomEvent('theChosen:persistent-store-conflict', {
              detail: { keys: conflicts }
            }));
            console.error(payload.error || 'Persistent site content changed on the server.');
            continue;
          }
          console.error('Persistent site content sync failed with status ' + response.status + '.');
          scheduleRetry();
          return;
        }
        const payload = await response.json();
        const latestVersions = payload && payload.versions && typeof payload.versions === 'object'
          ? payload.versions
          : {};
        keys.forEach(function (key) {
          if (pending[key] === items[key]) {
            delete pending[key];
            delete pendingVersions[key];
          } else {
            pendingVersions[key] = Number(latestVersions[key]) || submittedVersions[key] || 0;
          }
          versions[key] = Number(latestVersions[key]) || versions[key] || 0;
          if (items[key] === null || originalGetItem(key) === items[key]) {
            originalRemoveItem(key);
          }
        });
      }
    })().finally(function () {
      flushPromise = null;
    });
    return flushPromise;
  }

  function setScopedValue(key, value) {
    const nextValue = typeof value === 'string' ? value : String(value);
    const previous = Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : null;
    if (!Object.prototype.hasOwnProperty.call(pending, key)) {
      pendingVersions[key] = Number(versions[key]) || 0;
    }
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
      if (!Object.prototype.hasOwnProperty.call(pending, key)) {
        pendingVersions[key] = Number(versions[key]) || 0;
      }
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

  async function performHydration() {
    const nativeEntries = snapshotNativeScopedEntries();
    let hydrationSucceeded = false;
    let authoritativeItems = null;
    Object.keys(nativeEntries).forEach(function (key) {
      cache[key] = nativeEntries[key];
    });

    try {
      const token = await getIdentityToken();
      const headers = token ? { Authorization: 'Bearer ' + token } : {};
      const response = await fetch(ENDPOINT, { credentials: 'same-origin', cache: 'no-store', headers: headers });
      if (response.ok) {
        const payload = await response.json();
        if (
          !payload ||
          typeof payload !== 'object' ||
          !payload.items ||
          typeof payload.items !== 'object' ||
          Array.isArray(payload.items) ||
          !payload.versions ||
          typeof payload.versions !== 'object' ||
          Array.isArray(payload.versions) ||
          Object.keys(payload.items).some(function (key) { return typeof payload.items[key] !== 'string'; })
        ) {
          throw new Error('Persistent site content returned an invalid response.');
        }
        const items = payload.items;
        authoritativeItems = items;
        const remoteVersions = payload.versions;
        const remoteKeys = Object.keys(items).filter(function (key) {
          return isScopedKey(key) && typeof items[key] === 'string';
        });

        const previousEntries = { ...cache };
        Object.keys(cache).forEach(function (key) {
          delete cache[key];
          if (!Object.prototype.hasOwnProperty.call(pending, key)) {
            delete versions[key];
          }
        });
        remoteKeys.forEach(function (key) {
          cache[key] = items[key];
          versions[key] = Number(remoteVersions[key]) || 0;
        });
        Object.keys(pending).forEach(function (key) {
          if (pending[key] === null) {
            delete cache[key];
          } else {
            cache[key] = pending[key];
          }
        });
        Object.keys(nativeEntries).forEach(function (key) {
          if (
            key !== DIRECTORY_STORAGE_KEY &&
            !Object.prototype.hasOwnProperty.call(items, key) &&
            !Object.prototype.hasOwnProperty.call(pending, key)
          ) {
            cache[key] = nativeEntries[key];
            pending[key] = nativeEntries[key];
            pendingVersions[key] = 0;
          }
        });
        if (Object.keys(pending).length) {
          queueFlush();
        }
        Object.keys({ ...previousEntries, ...cache }).forEach(function (key) {
          if (previousEntries[key] !== cache[key]) {
            emitStorageChange(key);
          }
        });
        if (hydrationRetryTimer) {
          window.clearTimeout(hydrationRetryTimer);
          hydrationRetryTimer = null;
        }
        window.TheChosenPersistentStoreAuthoritative = true;
        hydrationSucceeded = true;
      } else {
        window.TheChosenPersistentStoreAuthoritative = false;
        hydrationRetryTimer = window.setTimeout(function () {
          hydrationRetryTimer = null;
          void hydrate();
        }, 5000);
      }
    } catch (error) {
      window.TheChosenPersistentStoreAuthoritative = false;
      if (!hydrationRetryTimer) {
        hydrationRetryTimer = window.setTimeout(function () {
          hydrationRetryTimer = null;
          void hydrate();
        }, 5000);
      }
    }

    if (hydrationSucceeded) {
      Object.keys(nativeEntries).forEach(function (key) {
        if (
          key === DIRECTORY_STORAGE_KEY ||
          Object.prototype.hasOwnProperty.call(authoritativeItems, key)
        ) {
          originalRemoveItem(key);
        }
      });
    }
    initialized = true;
    window.TheChosenPersistentStoreReady = true;
    window.dispatchEvent(new CustomEvent('theChosen:persistent-store-ready', {
      detail: { authoritative: window.TheChosenPersistentStoreAuthoritative === true }
    }));
  }

  function hydrate() {
    if (hydratePromise) {
      hydrateQueued = true;
      return hydratePromise;
    }
    hydratePromise = performHydration().finally(function () {
      hydratePromise = null;
      if (hydrateQueued) {
        hydrateQueued = false;
        void hydrate();
      }
    });
    return hydratePromise;
  }

  patchStorage();

  let identityConnected = false;
  let identityConnectTimer = null;
  function connectIdentityRefresh() {
    if (identityConnected || !window.netlifyIdentity || typeof window.netlifyIdentity.on !== 'function') {
      return;
    }
    identityConnected = true;
    if (identityConnectTimer) {
      window.clearInterval(identityConnectTimer);
      identityConnectTimer = null;
    }
    window.netlifyIdentity.on('init', function (user) {
      if (user) {
        void hydrate();
      }
    });
    window.netlifyIdentity.on('login', function () {
      void hydrate().then(function () {
        if (initialized) {
          queueFlush();
        }
      });
    });
    window.netlifyIdentity.on('logout', function () {
      if (Object.prototype.hasOwnProperty.call(cache, DIRECTORY_STORAGE_KEY)) {
        delete cache[DIRECTORY_STORAGE_KEY];
        emitStorageChange(DIRECTORY_STORAGE_KEY);
      }
    });
    if (typeof window.netlifyIdentity.currentUser === 'function' && window.netlifyIdentity.currentUser()) {
      void hydrate();
    }
  }
  identityConnectTimer = window.setInterval(connectIdentityRefresh, 50);
  window.setTimeout(function () {
    if (identityConnectTimer) {
      window.clearInterval(identityConnectTimer);
      identityConnectTimer = null;
    }
  }, 10000);
  connectIdentityRefresh();
  window.addEventListener('DOMContentLoaded', connectIdentityRefresh);
  if (!hydratePromise) {
    void hydrate();
  }
})();
