# Security Policy

<!-- Maintained by the project maintainers. Scope: the released software (digital track, print pipeline, tools) and the repository's automation. -->

## Supported versions

The project is pre-1.0 and is currently released from the `main` branch.

| Version | Supported |
| --- | --- |
| `main` (latest commit) | ✅ yes |
| Latest tagged release | ✅ yes |
| Older tagged releases | ❌ no — upgrade to the latest release |

Security fixes land on `main` and are included in the next tagged release.

## Reporting a vulnerability

**Do not open a public issue, pull request or discussion for a security
problem.** A public report gives attackers the details before a fix exists.

Report it privately instead:

1. Use **GitHub's private vulnerability reporting**:
   on this repository, go to **Security → Report a vulnerability** and submit
   the advisory form (this opens a private GitHub Security Advisory that only
   the maintainers can read).
2. If private reporting is unavailable on the repository, contact the project
   maintainers through the repository owner's GitHub profile and ask for a
   private channel.

Please include:

- the affected version, commit or file paths;
- a description of the issue and its impact;
- steps to reproduce (a minimal script or a failing test is ideal);
- any proof-of-concept output.

## What to expect

| Stage | Target |
| --- | --- |
| Acknowledgement | within 3 business days |
| Triage and severity assessment | within 7 business days |
| Fix released | within 30 days of confirmation, or a published mitigation plan |

If a report turns out not to be a vulnerability, you will get an explanation of
why, and the report will be closed as "not a security issue" — that is not a
rejection of you.

We ask that you give maintainers reasonable time to publish a fix before any
public disclosure, and we will credit you in the advisory unless you prefer
otherwise.

## Scope

In scope:

- the digital track (the single-file HTML build produced by `npm run build`
  and packaged by `npm run build:package`);
- the print pipeline (theme → IR → SVG/HTML/PDF) and the data it consumes;
- the engine, the tooling and the gate chain in `engine/`, `web/`, `build/`,
  `tools/`;
- the repository's CI configuration.

Out of scope:

- the optional Python AI-decision sidecar and the Playwright browser itself
  (third-party components; report those upstream);
- the hosted preview of the game, if any, which is operated separately from this
  repository.

## Not a security issue

The following are **functional** matters, not vulnerabilities. Please report
them through the normal issue templates so they are tracked and prioritised:

- **Gate false positives.** A gate that fails although the code is correct (for
  example a flaky browser-gate assertion or an environment issue such as a
  missing Chromium install). These are bugs in the tooling, reported as bugs.
- **Balance or rules disputes.** "This identity is too strong", "this threshold
  should be 9pp", "this card wording is unclear" — these are design and
  balance discussions. The project answers them with measurements
  (`npm run release:check`, the balance reports), and they belong in an issue
  or a discussion, not in an advisory.
- **Cosmetic and wording issues**, including translations and theme vocabulary
  preferences.
- **Feature requests** and design proposals.
- **Generated output** (`dist/`, `print/`) being out of date in a working
  tree; these outputs are rebuilt from source and are not tracked.
- **Absence of additional hardening** on a purely offline, single-file game
  (the digital track runs locally from `file://` with no server and no network
  access).

## Reporting a dependency problem

Report a vulnerable dependency through the same private channel, and include the
package name, the installed version and the advisory identifier. Third-party
dependency issues should also be reported upstream to the respective project.
