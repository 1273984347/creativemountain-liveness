# Contributing to Creativemountain Liveness

<!-- Maintained by the project maintainers. Scope: the whole repository (engine/, web/, themes/, build/, tools/, tests/, docs/). -->

《创界山·活人认证》(Creativemountain Liveness) is a 3–8 player tabletop strategy game
with a **physical track** (printable board, cards, rules book) and a **digital
track** (one offline HTML file). Both tracks are generated from the same rules
engine and the same theme packs, so a change in one track must reach the other.
The Chinese design specification lives in `docs/superpowers/specs/`; the English
entry point is [README.en.md](README.en.md).

## 1. Development environment

- **Node.js ≥ 22** (`engines.node` in `package.json`; CI uses Node 22, the
  maintainers work on 22 and 24) and npm; install with `npm ci`.
- **Playwright Chromium is required for gates ⑩ and ⑭**: `npx playwright install chromium`.
- **Python is optional** — only for the experimental *Laya sidecar*
  (`npm run env:laya`, `npm run sidecar:laya`, `npm run probe:laya`,
  `npm run eval:faces`), which evaluates candidate AI decision policies. No gate
  depends on it and it never enters the shipped game; the weights path in the
  `sidecar:laya` script is the maintainer's local one, so override it.

## 2. Common commands

All of these exist in `package.json`:

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` under strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` |
| `npm test` | Unit tests + resident gate self-checks (`node --test`) |
| `npm run test:engine` / `test:gates` / `test:e2e` | Engine tests / gate tests / build + duel browser end-to-end |
| `npm run build` / `build:only` | Typecheck + esbuild single-file HTML / esbuild only |
| `npm run build:ir` / `build:print` / `print` | IR only / physical track (IR → SVG → HTML → PDF) / IR + print |
| `npm run build:package` | Assemble `dist/发布包/` |
| `npm run gate` | **The one entry point**: all fourteen gates, any failure ⇒ exit 1 |
| `npm run release:check` / `release` | Gate + full re-scan + per-group baseline comparison (~10 min) / plus all builds |
| `npm run doc-sync` | Specification ↔ code drift check (C1–C10) |
| `npm run probe:laya` / `probe:laya:browser` / `probe:laya:skip` / `eval:faces` | Optional AI-decision probes and evaluation (not gated) |

## 3. Gate discipline

`npm run gate` (`node tools/gate.mjs`) is the **only** gate entry point: fourteen
gates in a fixed order (types, unit tests, document parity, build, theme packs,
IR contract, digital/physical parity, theme distinctness, balance smoke, duel
end-to-end, trial pass rate, position-spread lock, reserve threshold, browser
walkthrough), exiting 1 as soon as one fails. The catalogue with each gate's
responsibility, dependencies and troubleshooting is
`docs/沉淀/门禁清单.md`; the root `README.md` carries the one-line table.

- **Any failure ⇒ exit 1.** Never pipe gate output into another command (a
  pipeline hands you the last command's exit code); gate scripts must not use
  `shell: true`. Both are asserted by `tests/gates/discipline.test.ts`.
- **The order is a dependency order.** Gates ⑩ and ⑭ need the `dist/` bundle from
  gate ④; gates ⑥ and ⑦ need `print/<theme>/ir.json`, which is **git-ignored
  generated output**, regenerated on demand by the gate runner itself — so a
  fresh clone works. The gate count itself is asserted.
- **Changing an existing gate's criterion is a decision, not a fix.** Loosening a
  threshold or dropping an assertion must go through a batch (§5) that states the
  reason and updates `docs/沉淀/门禁清单.md` and the specification. A green gate
  weakened in passing is worse than a red gate.
- **A new gate** must (1) be appended to the `GATES` array in `tools/gate.mjs`,
  (2) declare its prerequisites and position, (3) ship a resident negative
  sample (§4), (4) be registered in the specification's acceptance criteria, and
  (5) be described in the gate catalogue and the `README.md` gate table.

## 4. Negative-sample discipline (violate ⇒ red, restore ⇒ green)

Every gate carries a **resident negative sample**: a test that deliberately breaks
what the gate protects and asserts that the gate turns red. Full paradigm:
[`docs/沉淀/负样本自证范式.md`](docs/沉淀/负样本自证范式.md).

- It must **fail on the broken state and pass on the restored state**; a negative
  sample that only ever passes proves nothing. A **positive sample** (unbroken ⇒
  green) is mandatory, otherwise you cannot tell "the guard has teeth" from
  "the environment is broken".
- **Never break the shared working tree.** Tests run in parallel, so an injected
  defect there makes other tests fail spuriously. Build an isolated copy instead
  (`tools/repo-copy.mjs`, `makeIsolatedRepo()`), mutate there, delete it in a
  `finally` block. A negative sample that writes to the repository is not a
  negative sample.
- The only evidence that a guard exists is a **mutation that makes it red**;
  grepping for a comment is not evidence.

## 5. Batch protocol

Work is organised in *batches* (B-numbers): **take a number** (check the session
list, working tree and staged area first) → **claim it** (record it, state which
shared surfaces you touch) → **implement** (plan in `docs/superpowers/plans/`,
design decision in `docs/superpowers/specs/`) → **cascade** (update the gate
catalogue `docs/沉淀/门禁清单.md`, the lesson index
`docs/沉淀/经验教训索引.md`, the navigation `docs/沉淀/批次导航.md`, the root
`README.md`) → **gate** (`npm run gate` green from a clean checkout) → **close
out** (execution record in `docs/批次/`, recount the navigation with
`node tools/presets/batch-nav-count.mjs`, then commit). The navigation counts
**rows, not batches** (some batches have several record files) and its totals must
agree with the table headers.

## 6. Branches and commits

- Branch names carry the batch number, e.g. `b66-pending-cert-lock`.
- Commit messages follow the existing style: `feat(B66): <what changed>`,
  `fix(B67): <what was wrong>`, `docs(<scope>): <what>`, `merge(B65): <batch>`.
- **Always commit with explicit pathspec.** `git add -A` and `git commit -a`
  are forbidden: they sweep in unrelated changes from parallel sessions and
  generated output. Name the paths you mean, and leave the tree in a state the
  gate accepts. Generated output (`dist/`, `print/`) is not committed.

## 7. Pull requests

Open a PR against `main` and describe: **what changed** (behaviour, not a file
list) · **why** (problem plus rejected alternative) · **how you verified it**,
pasting the **actual output** of the commands you ran (the `npm run gate` summary,
the `npm run doc-sync` 10/10 line, the measurement that changed — numbers, not
adjectives) · **negative samples** for any new or changed guard (what you broke,
and the red output proving the guard reacted) · **documentation sync** (which
specification sections, catalogue rows and documents you updated with the code).
Prose-only changes still need `npm run gate` green, because the chain includes
the document-parity gate; a reviewer may ask for a batch record when a change
touches rules, thresholds or gate criteria. Bugs and feature requests go to the
templates in `.github/ISSUE_TEMPLATE/`; **security issues → `SECURITY.md`, not
a public issue**.

## 8. Documentation must match the implementation

The specification in `docs/superpowers/specs/` is the source of truth, and
`npm run doc-sync` (gate ③) checks it against the code in both directions
(C1–C10). **§9.2 (simulation & balance)** and **§9.3 (digital/physical parity
gates)** must describe what the code actually does; new thresholds belong in
`engine/core/balance.ts` — the single source of truth — and in the specification,
not in a copy. A new engine `State` field missing from the specification is
caught by **C9**, a rules-book chapter that stops covering a terrain type by
**C10**, and the coverage-boundary table in §9.3 must correspond one-to-one with
`tools/coverage-boundaries.mjs` (**C8**). The Chinese documents under `docs/`
are the authoritative record; the English files at the repository root are the
international entry point — when they disagree, fix the English file and say so.

## 9. Code conventions that are actually enforced

- **TypeScript strictness**: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`,
  `verbatimModuleSyntax` — new code must pass `npm run typecheck`.
- **No theme vocabulary in the engine or the UI.** Player-visible sentences use
  placeholders (`{resource}`, `{gate}`, `{path}`, `{peak}`, `{hp}`,
  `{rift}`, `{hazard}`, `{player}`, `{identity:N}`) resolved from the current
  theme's 18-leaf `terms` contract. Literal theme words in `engine/` or
  `web/` fail a gate — a fifth theme must not require touching a sentence.
- **Self-check entry points belong to `tests/`** (or the historical
  `docs/批次/` area); the repository scanner rejects those tokens elsewhere.
- **Line endings are LF** (`.gitattributes`); no CRLF churn. When editing JSON
  theme packs, prefer the repository's text-level helpers over a JSON round-trip,
  which rewrites the whole file.

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
