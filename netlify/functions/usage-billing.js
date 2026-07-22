const OWNER_EMAIL = 'ojmac79@gmail.com';
const GITHUB_USERNAME = 'ojmac79';
const GITHUB_API_VERSION = '2026-03-10';

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

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && body.message ? body.message : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return body;
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function summarizeGitHub(items) {
  const usageItems = Array.isArray(items) ? items : [];
  const products = {};
  let grossAmount = 0;
  let discountAmount = 0;
  let netAmount = 0;

  usageItems.forEach((item) => {
    const product = String(item.product || 'Other');
    if (!products[product]) {
      products[product] = {
        product,
        grossAmount: 0,
        discountAmount: 0,
        netAmount: 0,
        items: []
      };
    }

    const normalized = {
      sku: String(item.sku || ''),
      quantity: Number(item.quantity ?? item.grossQuantity) || 0,
      unitType: String(item.unitType || ''),
      pricePerUnit: money(item.pricePerUnit),
      grossAmount: money(item.grossAmount),
      discountAmount: money(item.discountAmount),
      netAmount: money(item.netAmount),
      repositoryName: String(item.repositoryName || '')
    };
    products[product].items.push(normalized);
    products[product].grossAmount += normalized.grossAmount;
    products[product].discountAmount += normalized.discountAmount;
    products[product].netAmount += normalized.netAmount;
    grossAmount += normalized.grossAmount;
    discountAmount += normalized.discountAmount;
    netAmount += normalized.netAmount;
  });

  return {
    grossAmount,
    discountAmount,
    netAmount,
    products: Object.values(products).sort((left, right) => right.grossAmount - left.grossAmount)
  };
}

async function githubUsage(year, month) {
  const token = process.env.GITHUB_BILLING_TOKEN;
  if (!token) {
    return {
      configured: false,
      error: 'Set GITHUB_BILLING_TOKEN in Netlify environment variables to load GitHub billing data.',
      dashboardUrl: 'https://github.com/settings/billing/usage'
    };
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': GITHUB_API_VERSION
  };
  const query = `year=${year}&month=${month}`;

  try {
    const [profile, usage, summary] = await Promise.all([
      requestJson(`https://api.github.com/users/${GITHUB_USERNAME}`, { headers }),
      requestJson(`https://api.github.com/users/${GITHUB_USERNAME}/settings/billing/usage?${query}`, { headers }),
      requestJson(`https://api.github.com/users/${GITHUB_USERNAME}/settings/billing/usage/summary?${query}`, { headers })
    ]);
    const detailedItems = Array.isArray(usage && usage.usageItems) ? usage.usageItems : [];
    const summaryItems = Array.isArray(summary && summary.usageItems) ? summary.usageItems : detailedItems;

    return {
      configured: true,
      account: {
        login: String(profile.login || GITHUB_USERNAME),
        plan: profile.plan && profile.plan.name ? String(profile.plan.name) : '',
        profileUrl: String(profile.html_url || `https://github.com/${GITHUB_USERNAME}`)
      },
      period: { year, month },
      totals: summarizeGitHub(detailedItems),
      summary: summarizeGitHub(summaryItems),
      recentUsage: detailedItems
        .slice()
        .sort((left, right) => Date.parse(right.date || '') - Date.parse(left.date || ''))
        .slice(0, 20),
      dashboardUrl: 'https://github.com/settings/billing/usage'
    };
  } catch (error) {
    return {
      configured: true,
      error: error.message,
      dashboardUrl: 'https://github.com/settings/billing/usage'
    };
  }
}

function netlifyHeaders(token) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`
  };
}

function sanitizePaymentMethods(methods) {
  return (Array.isArray(methods) ? methods : []).map((method) => ({
    type: String(method.type || method.method || 'Payment method'),
    lastFour: String(method.last4 || method.last_four || ''),
    expirationMonth: Number(method.exp_month || method.expiration_month) || null,
    expirationYear: Number(method.exp_year || method.expiration_year) || null
  }));
}

async function netlifyUsage() {
  const token = process.env.NETLIFY_ACCESS_TOKEN;
  if (!token) {
    return {
      configured: false,
      error: 'Set NETLIFY_ACCESS_TOKEN in Netlify environment variables to load account and site usage.',
      dashboardUrl: 'https://app.netlify.com/teams/-/billing'
    };
  }

  const headers = netlifyHeaders(token);
  try {
    const accounts = await requestJson('https://api.netlify.com/api/v1/accounts', { headers });
    const requestedAccountId = String(process.env.NETLIFY_ACCOUNT_ID || '').trim();
    const accountList = Array.isArray(accounts) ? accounts : [];
    const account = accountList.find((item) => String(item.id || '') === requestedAccountId) ||
      accountList.find((item) => String(item.billing_email || '').trim().toLowerCase() === OWNER_EMAIL) ||
      accountList[0];

    if (!account || !account.id) {
      throw new Error('No Netlify account was available for this token.');
    }

    const accountId = String(account.id);
    const siteId = String(process.env.SITE_ID || process.env.NETLIFY_SITE_ID || '').trim();
    const requests = [
      requestJson(`https://api.netlify.com/api/v1/accounts/${encodeURIComponent(accountId)}`, { headers }),
      requestJson(`https://api.netlify.com/api/v1/${encodeURIComponent(accountId)}/builds/status`, { headers }),
      requestJson('https://api.netlify.com/api/v1/billing/payment_methods', { headers })
    ];
    if (siteId) {
      requests.push(
        requestJson(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteId)}`, { headers }),
        requestJson(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteId)}/deploys?per_page=20`, { headers })
      );
    }

    const values = await Promise.allSettled(requests);
    const accountDetails = values[0].status === 'fulfilled' ? values[0].value : account;
    const buildStatus = values[1].status === 'fulfilled' ? values[1].value : [];
    const paymentMethods = values[2].status === 'fulfilled' ? values[2].value : [];
    const site = siteId && values[3] && values[3].status === 'fulfilled' ? values[3].value : null;
    const deploys = siteId && values[4] && values[4].status === 'fulfilled' ? values[4].value : [];
    const capabilities = accountDetails.capabilities || {};

    return {
      configured: true,
      account: {
        id: accountId,
        name: String(accountDetails.name || accountDetails.slug || ''),
        slug: String(accountDetails.slug || ''),
        plan: String(accountDetails.type_name || accountDetails.type || ''),
        billingPeriod: String(accountDetails.billing_period || ''),
        billingEmail: String(accountDetails.billing_email || ''),
        capabilities: {
          sites: capabilities.sites || null,
          collaborators: capabilities.collaborators || null
        }
      },
      buildStatus: Array.isArray(buildStatus) ? buildStatus : [],
      paymentMethods: sanitizePaymentMethods(paymentMethods),
      site: site
        ? {
            id: String(site.id || siteId),
            name: String(site.name || ''),
            url: String(site.ssl_url || site.url || ''),
            adminUrl: String(site.admin_url || ''),
            state: String(site.state || ''),
            updatedAt: String(site.updated_at || ''),
            publishedDeploy: site.published_deploy
              ? {
                  id: String(site.published_deploy.id || ''),
                  createdAt: String(site.published_deploy.created_at || ''),
                  publishedAt: String(site.published_deploy.published_at || ''),
                  deployTime: Number(site.published_deploy.deploy_time) || 0,
                  state: String(site.published_deploy.state || '')
                }
              : null
          }
        : null,
      deploys: (Array.isArray(deploys) ? deploys : []).slice(0, 20).map((deploy) => ({
        id: String(deploy.id || ''),
        state: String(deploy.state || ''),
        createdAt: String(deploy.created_at || ''),
        publishedAt: String(deploy.published_at || ''),
        deployTime: Number(deploy.deploy_time) || 0,
        title: String(deploy.title || deploy.commit_ref || '')
      })),
      limitations: [
        'Netlify credit balance, invoices, and detailed spend are not consistently exposed by the public API for every plan.',
        'Use the Netlify billing dashboard link for authoritative credits remaining and invoice totals.'
      ],
      dashboardUrl: accountDetails.slug
        ? `https://app.netlify.com/teams/${encodeURIComponent(accountDetails.slug)}/billing`
        : 'https://app.netlify.com/teams/-/billing'
    };
  } catch (error) {
    return {
      configured: true,
      error: error.message,
      dashboardUrl: 'https://app.netlify.com/teams/-/billing'
    };
  }
}

exports.handler = async function handler(event, context) {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed.' });
  }
  if (requestEmail(context) !== OWNER_EMAIL) {
    return json(403, { error: 'Owner access required.' });
  }

  const now = new Date();
  const year = Math.max(2025, Math.min(2100, Number(event.queryStringParameters && event.queryStringParameters.year) || now.getUTCFullYear()));
  const month = Math.max(1, Math.min(12, Number(event.queryStringParameters && event.queryStringParameters.month) || now.getUTCMonth() + 1));
  const [github, netlify] = await Promise.all([githubUsage(year, month), netlifyUsage()]);

  return json(200, {
    generatedAt: new Date().toISOString(),
    period: { year, month },
    github,
    netlify
  });
};
