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

## Specifics for this architecture

Wealthline is a browser-only app served by one Cloudflare Worker. There is no user database, session service or contact list. Apply the sections above with these facts.

**Severity.** S1 is the mildest level here and S3 the worst, the reverse of the common SEV1-is-worst convention.

**Staffing.** One person may hold several roles. Independent review may be asynchronous, but the person who wrote a fix does not sign off on it alone.

**What a compromised published script could reach.** Treat all of the following as exposed for anyone who opened the site during the affected window, since there is no telemetry to confirm individual exposure:

- All financial records: the app's Drive files through the `drive.file` token, and local-mode records in this browser's storage. The token also allows modifying or deleting those Drive files, so integrity is in scope as well as confidentiality.
- The Google profile kept for sign-in (account identifier, email, name, picture).
- Every saved statement password. The encryption key cannot be exported, but any script on the origin can use it to decrypt. Passwords typed once and statement PDFs opened during the window are exposed too.
- New Google tokens. A returning user with an existing grant can be issued a token without a consent screen.

The Worker sets the Content-Security-Policy. When the deployment itself is compromised (S3), do not count the CSP as a mitigation.

**User guidance to add to the notice.** Reload or close every open Wealthline tab after recovery; open tabs keep running the old script until reloaded, and there is no service worker to clear. Do not sign in again or download backups from the site until it is announced clean. Google-mode users review Drive version history for the data files, or restore from a backup they hold. Local-mode users have no Google step; their browser records and saved statement passwords are the exposure.

**Notification channel.** Users cannot be contacted individually. The primary channel must be off the site, because in S3 the site is attacker-controlled: a GitHub Security Advisory, a pinned issue and the README of the public repository. An in-app or home-page banner is secondary and is used only after a verified clean deploy. Record the incident privately in a draft GitHub Security Advisory; reports arrive through the repository's private vulnerability reporting.

**Rollback and containment.**

- Production deploys from git through Workers Builds. A rollback to an earlier Worker version is overwritten by the next push to the production branch, so pair it with a revert of the bad commit or lockfile and pause Workers Builds until the candidate is verified.
- Pull-request preview deployments are a publish path too. Include them when checking what was served.
- No maintenance page exists. Serving one is itself a deploy through the possibly compromised path, so prefer rollback to a verified version.
- A rollback does not purge edge-cached quote responses. They hold public market data only; purge them if the quote relay was affected.

**Deployment identities.** The identities that can change what users receive are the Cloudflare account and its API tokens, the GitHub repository that drives Workers Builds, the DNS and registrar for the custom domain, and the Google Cloud project that owns the OAuth client. The Worker holds no secrets to rotate. The Google Cloud owner can disable the OAuth client or remove the authorized origin to stop new tokens for everyone; this breaks sign-in for all users and does not cancel tokens already issued, which last until they expire.

## Adoption checklist

- [ ] Name actual incident lead, release operator, independent security reviewer and communications owner, with backups and secure contact channel.
- [ ] Verify who can block merges/publication, inspect GitHub rulesets and Cloudflare Builds/direct Wrangler paths, identify a previously verified safe artifact, and test a blocked release. See [release gate enforcement](release-security.md#enforcement-to-configure-and-verify).
- [ ] Verify access to deploy logs, artifact hashes, provider credential rotation, maintenance/rollback and user communications. Write current provider steps in a restricted operations location and test them without real user data.
- [ ] Agree on record location, severity escalation, approval authority, user notification channel and review interval. Complete the [paper tabletop](security-incident-tabletop.md) before adopting this runbook.

This runbook cannot guarantee attack detection. It adds no telemetry or account controls by itself.
