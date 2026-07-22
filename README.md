# thechosenguild

The Chosen Guild

Welcome to the repository for **The Chosen Guild**, hosted at thechosenguild.netlify.app. This project is optimized for development inside GitHub Codespaces.

## Deployment

This repository is set up as a static site and can be deployed to Netlify directly from GitHub.

### Netlify deployment steps

1. Create or connect a Netlify site to this repository.
2. Set the build command to an empty value or leave it blank.
3. Set the publish directory to the repository root.
4. Deploy the main branch.

### Owner usage and billing dashboard

The private `/usage-billing/` page is visible only to the Netlify Identity owner account and loads provider data through an owner-authenticated Netlify Function. Configure these environment variables in the Netlify site settings:

- `GITHUB_BILLING_TOKEN`: GitHub personal access token authorized to read billing usage for `ojmac79`.
- `NETLIFY_ACCESS_TOKEN`: Netlify personal access token for the owner account.
- `NETLIFY_ACCOUNT_ID`: Optional account ID when the access token belongs to more than one Netlify account.

Provider tokens are read only by the server function and must not be added to this repository or browser code. Netlify credit balances and invoices are not consistently available through its public API, so the dashboard links to Netlify billing for those authoritative totals.

### Local preview

Run a simple local server from the repository root:

```bash
python3 -m http.server 8000
```

Then open http://127.0.0.1:8000/ in your browser.
