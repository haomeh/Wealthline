# Release security gate

The `verify / release-check` GitHub Actions job runs for pull requests into `main` and pushes to `main`. It uses a read-only token, does not persist checkout credentials, and receives no deployment secrets. The job pins Ubuntu 24.04, Node 22.22.1, npm 10.9.4, and immutable action commits ([checkout v4.2.2](https://github.com/actions/checkout/commit/11bd71901bbe5b1630ceea73d27597364c9af683), [setup-node v4.4.0](https://github.com/actions/setup-node/commit/49933ea5288caeca8642d1e84afbd3f7d6820020)).

`scripts/verify-release.sh` uses the lockfile, disables dependency install scripts, then requires a successful high-severity audit (including development dependencies), npm registry signature verification, tests, lint, typecheck, full prerender build, local OCR assets, and installed Wrangler dry-run. The explicit project `pretest` and `prebuild` scripts copy OCR files from installed packages. An audit registry outage, invalid signature, missing asset, or command failure stops the job; do not use `continue-on-error` or interpret unavailable audit data as clean. Registry signatures establish package origin, not code safety. Package counts and signature/attestation totals are observations, not fixed thresholds.

Review low and moderate advisories for reachability, exposure, fixes, and compensating controls before release; record the decision and revisit it when dependency versions change. High or critical findings require a separately approved dependency change or a documented exception reviewed before release. Do not disable the gate to unblock a release.

## Enforcement to configure and verify

1. In the GitHub ruleset for `main`, require `verify / release-check` from GitHub Actions, block direct pushes, and disallow bypass for the production release path. Confirm the rule applies to administrators and automation identities used for release. Run a failing candidate and verify that merge is blocked.
2. In Cloudflare, inspect the active Workers Builds source, branch settings, preview settings, and any dashboard/direct Wrangler deploy paths. Production must consume an artifact from the verified commit or repeat the same fail-closed checks for that exact commit before publishing. Verify a failing candidate cannot publish through any enabled path; inspect preview deployment behavior separately.
3. Record the actual ruleset and Cloudflare settings plus a blocked-release result before describing this check as enforced in production. Until then, the repository check is implemented and production enforcement is unverified.

Rollback a broken gate only through a reviewed workflow correction or an explicitly approved rollback. No data migration is involved.
