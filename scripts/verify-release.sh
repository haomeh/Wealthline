#!/usr/bin/env bash
set -euo pipefail

test "$(node --version)" = v22.22.1
test "$(npm --version)" = 10.9.4
npm ci --ignore-scripts --include=dev
npm audit --audit-level=high --include=dev
npm audit signatures
npm test
npm run lint
./node_modules/.bin/tsc -b
npm run build

for file in index.html privacy.html terms.html disclaimer.html sitemap.xml ocr/7.0.0/worker.min.js ocr/7.0.0/lang/eng.traineddata.gz ocr/7.0.0/lang/chi_tra.traineddata.gz; do
  test -s "dist/$file"
done
./node_modules/.bin/wrangler deploy --dry-run
