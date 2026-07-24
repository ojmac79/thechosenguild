(function () {
  const ENDPOINT = '/.netlify/functions/news';
  const HOME_LIMIT = 3;
  const state = {
    posts: [],
    editingId: '',
    archiveOpen: false,
    loading: false
  };

  const list = document.getElementById('homeNewsList');
  const archive = document.getElementById('homeNewsArchive');
  const archiveToggle = document.getElementById('homeNewsArchiveToggle');
  const newButton = document.getElementById('homeNewsNewButton');
  const form = document.getElementById('homeNewsForm');
  const titleInput = document.getElementById('homeNewsTitle');
  const bodyInput = document.getElementById('homeNewsBody');
  const forumInput = document.getElementById('homeNewsPostToForum');
  const cancelButton = document.getElementById('homeNewsCancel');
  const submitButton = document.getElementById('homeNewsSubmit');
  const notice = document.getElementById('homeNewsNotice');

  if (!list || !archive || !archiveToggle || !newButton || !form) {
    return;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function currentIdentityUser() {
    if (!window.netlifyIdentity || typeof window.netlifyIdentity.currentUser !== 'function') {
      return null;
    }
    return window.netlifyIdentity.currentUser();
  }

  function canEditNews() {
    const guildAccess = window.TheChosenGuildAccess;
    const user = currentIdentityUser();
    return Boolean(guildAccess && guildAccess.getPermissions(user).canEditSite);
  }

  function normalizePost(post) {
    if (!post || typeof post !== 'object') {
      return null;
    }
    const title = String(post.title || '').trim();
    const body = String(post.body || '').trim();
    if (!title || !body) {
      return null;
    }
    const createdAt = Number(post.createdAt) || Number(post.updatedAt) || 0;
    return {
      id: String(post.id || ''),
      title,
      body,
      authorName: String(post.authorName || post.author || 'Guild Leader'),
      authorAvatar: String(post.authorAvatar || post.avatar || ''),
      createdAt,
      updatedAt: Number(post.updatedAt) || createdAt,
      postedToForum: Boolean(post.postedToForum),
      forumThreadId: String(post.forumThreadId || '')
    };
  }

  function normalizePosts(posts) {
    if (!Array.isArray(posts)) {
      return [];
    }
    return posts
      .map(normalizePost)
      .filter(Boolean)
      .sort((left, right) => {
        const createdDelta = right.createdAt - left.createdAt;
        return createdDelta || right.updatedAt - left.updatedAt;
      });
  }

  function avatarUrl(post) {
    return post.authorAvatar ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(post.authorName)}&background=ff7b7b&color=14070b`;
  }

  function timestampLabel(post) {
    const wasEdited = post.updatedAt > post.createdAt;
    const timestamp = wasEdited ? post.updatedAt : post.createdAt;
    const label = wasEdited ? 'Edited' : 'Posted';
    return `${label} ${new Date(timestamp).toLocaleString()}`;
  }

  function postMarkup(post, archived) {
    const editButton = canEditNews()
      ? `<button class="resource-item__edit" type="button" data-news-edit="${escapeHtml(post.id)}">Edit</button>`
      : '';
    const forumBadge = post.postedToForum
      ? '<span class="forum-badge forum-badge--member">Public Forum</span>'
      : '';
    return `
      <article class="panel home-news__article" id="news-${escapeHtml(post.id)}">
        <div class="home-news__article-header">
          <div>
            <p class="home-news__eyebrow">${archived ? 'Archive' : 'Guild News'}</p>
            <h3 class="home-news__article-title">${escapeHtml(post.title)}</h3>
          </div>
          <div class="home-news__badges">
            ${forumBadge}
            <span class="forum-badge">${archived ? 'Archive' : 'News'}</span>
          </div>
        </div>
        <div class="home-news__author">
          <img class="forum-thread__author-avatar" src="${escapeHtml(avatarUrl(post))}" alt="${escapeHtml(post.authorName)} avatar" />
          <span>${escapeHtml(post.authorName)}</span>
          <span class="home-news__timestamp">${escapeHtml(timestampLabel(post))}</span>
        </div>
        <p class="home-news__body">${escapeHtml(post.body)}</p>
        <div class="resource-item__actions">${editButton}</div>
      </article>
    `;
  }

  function updateOwnerControls() {
    const canEdit = canEditNews();
    newButton.hidden = !canEdit;
    if (!canEdit) {
      closeEditor();
    }
  }

  function render() {
    updateOwnerControls();
    if (state.loading && !state.posts.length) {
      list.innerHTML = '<div class="panel empty-state"><p>Loading guild news...</p></div>';
      archive.hidden = true;
      archiveToggle.hidden = true;
      return;
    }

    if (!state.posts.length) {
      list.innerHTML = '<div class="panel empty-state"><p>No guild news has been posted yet.</p></div>';
      archive.hidden = true;
      archiveToggle.hidden = true;
      return;
    }

    const currentPosts = state.posts.slice(0, HOME_LIMIT);
    const archivedPosts = state.posts.slice(HOME_LIMIT);
    list.innerHTML = currentPosts.map((post) => postMarkup(post, false)).join('');

    archive.hidden = !archivedPosts.length;
    archiveToggle.hidden = !archivedPosts.length;
    archiveToggle.textContent = state.archiveOpen
      ? 'Hide Archived News'
      : `View ${archivedPosts.length} Archived Article${archivedPosts.length === 1 ? '' : 's'}`;
    const archiveList = document.getElementById('homeNewsArchiveList');
    archiveList.hidden = !state.archiveOpen;
    archiveList.innerHTML = state.archiveOpen
      ? archivedPosts.map((post) => postMarkup(post, true)).join('')
      : '';
  }

  function setNotice(message, type) {
    notice.textContent = message;
    notice.className = type ? `resource-notice resource-notice--${type}` : 'resource-notice';
  }

  function closeEditor() {
    state.editingId = '';
    form.hidden = true;
    form.reset();
    submitButton.textContent = 'Publish News';
  }

  function openEditor(post) {
    if (!canEditNews()) {
      window.location.href = '/login/';
      return;
    }
    state.editingId = post ? post.id : '';
    titleInput.value = post ? post.title : '';
    bodyInput.value = post ? post.body : '';
    forumInput.checked = Boolean(post && post.postedToForum);
    submitButton.textContent = post ? 'Save Changes' : 'Publish News';
    form.hidden = false;
    titleInput.focus();
  }

  async function identityToken() {
    const user = currentIdentityUser();
    if (!user || typeof user.jwt !== 'function') {
      return '';
    }
    try {
      return await user.jwt();
    } catch (error) {
      return '';
    }
  }

  async function loadPosts() {
    state.loading = true;
    render();
    try {
      const response = await fetch(ENDPOINT, {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (!response.ok) {
        throw new Error('The news server could not be reached.');
      }
      const payload = await response.json();
      state.posts = normalizePosts(payload && payload.posts);
      setNotice('', '');
    } catch (error) {
      setNotice(error && error.message ? error.message : 'Guild news could not be loaded.', 'error');
    } finally {
      state.loading = false;
      render();
    }
  }

  async function savePost(event) {
    event.preventDefault();
    if (!canEditNews()) {
      window.location.href = '/login/';
      return;
    }

    const token = await identityToken();
    if (!token) {
      setNotice('Your editor session expired. Sign in again before publishing.', 'error');
      return;
    }

    const user = currentIdentityUser();
    const payload = {
      id: state.editingId,
      title: titleInput.value.trim(),
      body: bodyInput.value.trim(),
      postToForum: forumInput.checked,
      authorName: (user.user_metadata && user.user_metadata.full_name) || user.email.split('@')[0],
      authorAvatar: (user.user_metadata && user.user_metadata.avatar_url) || user.avatar_url || ''
    };
    if (!payload.title || !payload.body) {
      setNotice('Enter both a title and a message.', 'error');
      return;
    }

    submitButton.disabled = true;
    setNotice(state.editingId ? 'Saving changes...' : 'Publishing news...', '');
    try {
      const response = await fetch(ENDPOINT, {
        method: state.editingId ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'The news article could not be saved.');
      }
      state.posts = normalizePosts(result.posts);
      closeEditor();
      if (result.forumWarning) {
        setNotice(result.forumWarning, 'error');
      } else {
        setNotice(result.forumCopied ? 'News published and copied to the public forum.' : 'News published.', 'success');
      }
      render();
    } catch (error) {
      setNotice(error && error.message ? error.message : 'The news article could not be saved.', 'error');
    } finally {
      submitButton.disabled = false;
    }
  }

  function handleEditClick(event) {
    const button = event.target.closest('[data-news-edit]');
    if (!button) {
      return;
    }
    const post = state.posts.find((candidate) => candidate.id === button.getAttribute('data-news-edit'));
    if (post) {
      openEditor(post);
    }
  }

  newButton.addEventListener('click', () => openEditor(null));
  cancelButton.addEventListener('click', closeEditor);
  form.addEventListener('submit', savePost);
  list.addEventListener('click', handleEditClick);
  document.getElementById('homeNewsArchiveList').addEventListener('click', handleEditClick);
  archiveToggle.addEventListener('click', () => {
    state.archiveOpen = !state.archiveOpen;
    render();
  });

  if (window.netlifyIdentity && typeof window.netlifyIdentity.on === 'function') {
    window.netlifyIdentity.on('init', updateOwnerControls);
    window.netlifyIdentity.on('login', updateOwnerControls);
    window.netlifyIdentity.on('logout', updateOwnerControls);
  }
  window.addEventListener('storage', (event) => {
    const guildAccess = window.TheChosenGuildAccess;
    if (guildAccess && event.key === guildAccess.DIRECTORY_STORAGE_KEY) {
      updateOwnerControls();
      render();
    }
  });
  window.addEventListener('theChosen:persistent-store-ready', () => {
    updateOwnerControls();
    render();
  });

  updateOwnerControls();
  void loadPosts();
})();
