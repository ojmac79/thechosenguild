# thechosenguild

The Chosen Guild

Welcome to the repository for **The Chosen Guild**, hosted at thechosenguild.netlify.app. This project is optimized for development inside GitHub Codespaces.

## Deployment

This repository is set up as a static site and can be deployed to Netlify directly from GitHub.
The guild membership system now also uses a Netlify Function plus Netlify Blobs for secure member storage.

### Netlify deployment steps

1. Create or connect a Netlify site to this repository.
2. Set the build command to an empty value or leave it blank.
3. Set the publish directory to the repository root.
4. Deploy the main branch.

### Local preview

Run a simple local server from the repository root:

```bash
npm install
python3 -m http.server 8000
```

Then open http://127.0.0.1:8000/ in your browser.

Note: the secure membership management flow calls `/.netlify/functions/guild-membership`, so those features require Netlify deployment or a local Netlify Functions environment to work end to end.
