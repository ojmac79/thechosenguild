(function () {
  const OWNER_EMAIL = 'ojmac79@gmail.com';
  const gate = document.getElementById('billingGate');
  const gateMessage = document.getElementById('billingGateMessage');
  const app = document.getElementById('billingApp');
  const notice = document.getElementById('billingNotice');
  const monthInput = document.getElementById('billingMonth');
  const refreshButton = document.getElementById('billingRefresh');

  function text(value) {
    return String(value == null ? '' : value);
  }

  function escapeHtml(value) {
    return text(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function currency(value) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
  }

  function number(value) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(Number(value) || 0);
  }

  function dateTime(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'Unavailable' : parsed.toLocaleString();
  }

  function currentUser() {
    return window.netlifyIdentity && window.netlifyIdentity.currentUser();
  }

  function isOwner(user) {
    return text(user && user.email).trim().toLowerCase() === OWNER_EMAIL;
  }

  function setStatus(id, label, state) {
    const element = document.getElementById(id);
    element.textContent = label;
    element.className = `badge billing-status billing-status--${state}`;
  }

  function setGate(user) {
    if (isOwner(user)) {
      gate.hidden = true;
      app.hidden = false;
      return true;
    }

    app.hidden = true;
    gate.hidden = false;
    gateMessage.textContent = user
      ? 'This account is not authorized to view owner usage or billing.'
      : 'Sign in with the owner Netlify account to view account usage and billing.';
    return false;
  }

  function renderGitHub(provider) {
    const details = document.getElementById('githubDetails');
    const rows = document.getElementById('githubUsageRows');
    document.getElementById('githubDashboardLink').href = provider.dashboardUrl || 'https://github.com/settings/billing/usage';

    if (!provider.configured || provider.error) {
      setStatus('githubStatus', provider.configured ? 'API Error' : 'Not Configured', 'warning');
      details.innerHTML = `<p class="resource-notice resource-notice--error">${escapeHtml(provider.error || 'GitHub billing is unavailable.')}</p>`;
      rows.innerHTML = '<tr><td colspan="6">GitHub usage is unavailable.</td></tr>';
      document.getElementById('githubGross').textContent = '$0.00';
      document.getElementById('githubDiscount').textContent = '$0.00';
      document.getElementById('githubNet').textContent = '$0.00';
      return;
    }

    setStatus('githubStatus', 'Connected', 'connected');
    const totals = provider.totals || {};
    document.getElementById('githubGross').textContent = currency(totals.grossAmount);
    document.getElementById('githubDiscount').textContent = currency(totals.discountAmount);
    document.getElementById('githubNet').textContent = currency(totals.netAmount);
    details.innerHTML = `
      <dl class="billing-definition-list">
        <div><dt>Account</dt><dd>${escapeHtml(provider.account && provider.account.login)}</dd></div>
        <div><dt>Plan</dt><dd>${escapeHtml(provider.account && provider.account.plan || 'Unavailable')}</dd></div>
        <div><dt>Products metered</dt><dd>${escapeHtml((totals.products || []).length)}</dd></div>
      </dl>
    `;

    const products = Array.isArray(totals.products) ? totals.products : [];
    const items = products.flatMap((product) =>
      (product.items || []).map((item) => ({ ...item, product: product.product }))
    );
    rows.innerHTML = items.length
      ? items.map((item) => `
          <tr>
            <td><strong>${escapeHtml(item.product)}</strong><br /><span>${escapeHtml(item.sku || 'Usage')}</span></td>
            <td>${escapeHtml(number(item.quantity))} ${escapeHtml(item.unitType)}</td>
            <td>${escapeHtml(currency(item.pricePerUnit))}</td>
            <td>${escapeHtml(currency(item.grossAmount))}</td>
            <td>${escapeHtml(currency(item.discountAmount))}</td>
            <td>${escapeHtml(currency(item.netAmount))}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="6">No GitHub usage was reported for this month.</td></tr>';
  }

  function capability(capability) {
    if (!capability) {
      return 'Unavailable';
    }
    const used = Number(capability.used) || 0;
    const included = Number(capability.included);
    return Number.isFinite(included) ? `${used} of ${included}` : text(used);
  }

  function renderNetlify(provider) {
    const details = document.getElementById('netlifyDetails');
    const deployList = document.getElementById('netlifyDeployList');
    document.getElementById('netlifyDashboardLink').href = provider.dashboardUrl || 'https://app.netlify.com/teams/-/billing';

    if (!provider.configured || provider.error) {
      setStatus('netlifyStatus', provider.configured ? 'API Error' : 'Not Configured', 'warning');
      details.innerHTML = `<p class="resource-notice resource-notice--error">${escapeHtml(provider.error || 'Netlify usage is unavailable.')}</p>`;
      deployList.innerHTML = '<p class="forum2-note">Netlify deploy activity is unavailable.</p>';
      document.getElementById('netlifySites').textContent = '-';
      document.getElementById('netlifyDeploys').textContent = '-';
      return;
    }

    setStatus('netlifyStatus', 'Connected', 'connected');
    const account = provider.account || {};
    const capabilities = account.capabilities || {};
    const deploys = Array.isArray(provider.deploys) ? provider.deploys : [];
    const buildStatus = Array.isArray(provider.buildStatus) ? provider.buildStatus[0] : provider.buildStatus;
    const minutes = buildStatus && buildStatus.minutes ? buildStatus.minutes : null;
    document.getElementById('netlifySites').textContent = capability(capabilities.sites);
    document.getElementById('netlifyDeploys').textContent = text(deploys.length);
    details.innerHTML = `
      <dl class="billing-definition-list">
        <div><dt>Account</dt><dd>${escapeHtml(account.name || account.slug || 'Unavailable')}</dd></div>
        <div><dt>Plan</dt><dd>${escapeHtml(account.plan || 'Unavailable')}</dd></div>
        <div><dt>Billing period</dt><dd>${escapeHtml(account.billingPeriod || 'Unavailable')}</dd></div>
        <div><dt>Sites</dt><dd>${escapeHtml(capability(capabilities.sites))}</dd></div>
        <div><dt>Collaborators</dt><dd>${escapeHtml(capability(capabilities.collaborators))}</dd></div>
        <div><dt>Build minutes</dt><dd>${escapeHtml(minutes ? `${number(minutes.current)} of ${number(minutes.included_minutes_with_packs || minutes.included_minutes)}` : 'Unavailable')}</dd></div>
        <div><dt>Site state</dt><dd>${escapeHtml(provider.site && provider.site.state || 'Unavailable')}</dd></div>
        <div><dt>Payment methods</dt><dd>${escapeHtml((provider.paymentMethods || []).length)}</dd></div>
      </dl>
      ${(provider.limitations || []).map((item) => `<p class="forum2-note">${escapeHtml(item)}</p>`).join('')}
    `;
    deployList.innerHTML = deploys.length
      ? deploys.map((deploy) => `
          <article class="billing-deploy">
            <div>
              <strong>${escapeHtml(deploy.title || 'Site deployment')}</strong>
              <p>${escapeHtml(dateTime(deploy.publishedAt || deploy.createdAt))}</p>
            </div>
            <span class="badge">${escapeHtml(deploy.state || 'unknown')}</span>
          </article>
        `).join('')
      : '<p class="forum2-note">No recent deploys were returned by Netlify.</p>';
  }

  async function loadUsage() {
    const user = currentUser();
    if (!setGate(user)) {
      return;
    }

    refreshButton.disabled = true;
    notice.textContent = 'Loading private account usage...';
    setStatus('githubStatus', 'Loading', 'loading');
    setStatus('netlifyStatus', 'Loading', 'loading');

    try {
      const token = await user.jwt();
      const selected = monthInput.value ? monthInput.value.split('-') : [];
      const query = new URLSearchParams({
        year: selected[0] || String(new Date().getFullYear()),
        month: selected[1] || String(new Date().getMonth() + 1)
      });
      const response = await fetch(`/.netlify/functions/usage-billing?${query}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Usage data could not be loaded.');
      }
      renderGitHub(data.github || {});
      renderNetlify(data.netlify || {});
      document.getElementById('billingUpdated').textContent = dateTime(data.generatedAt);
      notice.textContent = 'Account usage loaded from GitHub and Netlify.';
      notice.className = 'resource-notice resource-notice--success';
    } catch (error) {
      notice.textContent = error.message;
      notice.className = 'resource-notice resource-notice--error';
      setStatus('githubStatus', 'Unavailable', 'warning');
      setStatus('netlifyStatus', 'Unavailable', 'warning');
    } finally {
      refreshButton.disabled = false;
    }
  }

  const now = new Date();
  monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  refreshButton.addEventListener('click', loadUsage);
  monthInput.addEventListener('change', loadUsage);

  if (window.netlifyIdentity) {
    window.netlifyIdentity.on('init', (user) => {
      if (setGate(user)) {
        loadUsage();
      }
    });
    window.netlifyIdentity.on('login', (user) => {
      if (setGate(user)) {
        window.netlifyIdentity.close();
        loadUsage();
      }
    });
    window.netlifyIdentity.on('logout', () => setGate(null));
    window.netlifyIdentity.init();
  } else {
    setGate(null);
  }
})();
