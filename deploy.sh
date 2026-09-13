#!/usr/bin/env bash
# Safe deploy for XUDOMovie (Cloudflare Pages, Direct Upload).
#
# NEVER run `wrangler pages deploy .` on this project: wrangler 3.x uploads the
# whole directory and honours neither .gitignore nor .assetsignore, so .dev.vars
# (TMDB_API_KEY, MAL_CLIENT_ID) ends up publicly served. This script stages only
# the files the site actually needs into dist/ and deploys that.
set -euo pipefail

cd "$(dirname "$0")"
[ -d dist ] && chmod -R u+w dist   # css/ is read-only; make the tree removable
rm -rf dist && mkdir -p dist

# Site assets + Pages Functions. Everything not listed here stays off the CDN.
cp -R css js functions dist/
chmod -R u+w dist
cp ./*.html icon.svg robots.txt sitemap.xml dist/

# Guard: refuse to ship if anything sensitive slipped in.
if find dist -name '.dev.vars*' -o -name '.env*' -o -name '*.pem' -o -name '*.key' | grep -q .; then
    echo "ABORT: secret-looking file found in dist/" >&2
    find dist -name '.dev.vars*' -o -name '.env*' -o -name '*.pem' -o -name '*.key' >&2
    exit 1
fi

echo "Staged $(find dist -type f | wc -l | tr -d ' ') files in dist/"
npx wrangler pages deploy dist --project-name=xudomovie --branch=main "$@"
