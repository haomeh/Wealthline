# Security incident response runbook — adoption draft

Use this when a dependency, published asset, or deployment identity may be compromised. This runbook assigns responsibilities by role; it does not name real people, grant access, authorize deployment or send notifications. Adopt it only after the checklist below identifies actual operators and verified production controls. Record times in UTC, with a named source for each fact. Keep incident notes free of tokens, credentials, financial records and raw user files.

## Roles and decision authority

| Role | Responsibility |
| --- | --- |
| Incident lead | Opens the record, sets severity and affected window, appoints people to the other roles, approves escalation and reopening. |
| Release operator | Stops pending publication where authorized, identifies a known safe artifact, and executes an authorized rollback or maintenance action. |
| Security reviewer | Preserves non-sensitive evidence, reviews dependency/build provenance and validates the recovery candidate independently. |
| User communications owner | Drafts fact-checked updates and user guidance; sends only after the authorized human approves recipients, channel and wording. |

Any role can request a release hold. The person who can enforce it must be named during adoption; absent that assignment, escalate to the repository and hosting owners before publishing. Only operators with explicit authority change production, revoke credentials or contact users.

## Triage and record

1. Create a private incident record with detection time, reporter, source link, observed behavior, affected commit and build/artifact identifier, deployed version or URL, earliest/latest possible exposure, confidence level, and what remains unknown. Capture hashes, workflow results, deploy metadata, headers and screenshots only if they contain no secrets or user records. Preserve original evidence and note its source and collection time.
2. Classify by observed impact, not speculation: **S1 suspected** package advisory or suspicious build before publication; **S2 published exposure** confirmed malicious or untrusted asset served to users; **S3 deployment identity** unauthorized publish or credible compromise of a production deployment account. Raise severity if evidence expands the affected window. If evidence is insufficient, keep the uncertainty explicit and pause publication of the candidate.
3. Record the decision owner, next update time and every authorization. Do not paste access tokens, statement passwords, financial JSON or user identifiers into tickets or chat.

## Containment

- Hold the affected candidate and preserve its commit, lockfile, audit/signature results, workflow run and artifact identity. [Release security gate](release-security.md) describes the repository checks; the gate is not yet verified as enforced by GitHub rulesets or Cloudflare production settings.
- For a published incident, compare the hosted asset and headers with a previously verified safe artifact. If none is available, prepare a maintenance option; do not rebuild a rollback artifact in an environment or with credentials suspected compromised. Do not assume a prior commit is safe without checking its dependencies and artifact provenance.
- If a deployment identity may be compromised, an authorized owner pauses direct and automated publish paths and rotates/revokes affected credentials using the provider's current procedure. Record which paths were checked. This document contains no provider commands because the active configuration and permissions have not been verified.
- Keep the affected page out of use where a safe, authorized maintenance or rollback path exists. Never destroy users' Drive files or local records as a containment shortcut.

## User guidance and communication

The communications owner drafts a short notice with the observed fact, affected URL/version/time window, confidence and uncertainty, what users should do now, and when the next update will appear. Say “stop using the affected page” if it is still served. If Google authorization may have been exposed, direct users to [Google Account third-party connections](https://myaccount.google.com/connections) to review and revoke Wealthline access. Revocation stops access; it does **not** delete Drive files. If a saved or reused statement password was confirmed exposed, tell affected users to change it with the relevant bank or statement provider and reset the saved setting. Do not claim all browser sessions were revoked: this app has no central session service. Do not instruct users to delete their financial records or backups as incident containment. Send only after a human with communications authority approves the actual message and recipients.

## Recovery and closure

1. Establish a clean source and build environment. Verify the commit, lockfile, dependency advisory decision, npm audit and signatures, tests, lint, typecheck, prerendered public pages/OCR assets, Worker dry-run and security headers using [release security gate](release-security.md). Audit and signatures do not prove code is benign.
2. Independently verify the exact artifact to publish and the hosted artifact after any authorized recovery: asset identity, public routes, response headers, and whether every enabled deploy path consumed the checked commit/artifact. Compare against the incident's affected window.
3. Incident lead documents residual uncertainty, user impact, credential actions actually taken, monitoring or detection gaps, and approves reopening only after the release operator and security reviewer sign off. Record the user update decision and follow-up owner.

## Adoption checklist

- [ ] Name actual incident lead, release operator, independent security reviewer and communications owner, with backups and secure contact channel.
- [ ] Verify who can block merges/publication, inspect GitHub rulesets and Cloudflare Builds/direct Wrangler paths, identify a previously verified safe artifact, and test a blocked release. See [release gate enforcement](release-security.md#enforcement-to-configure-and-verify).
- [ ] Verify access to deploy logs, artifact hashes, provider credential rotation, maintenance/rollback and user communications. Write current provider steps in a restricted operations location and test them without real user data.
- [ ] Agree on record location, severity escalation, approval authority, user notification channel and review interval. Complete the [paper tabletop](security-incident-tabletop.md) before adopting this runbook.

This runbook cannot guarantee attack detection. It adds no telemetry or account controls by itself.
