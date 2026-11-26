# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The balance report now has a gate watching it. `docs/balance-report.md` was a
  committed generated artefact that **no gate ever read**, so it could silently
  go stale after an engine change — and any document quoting it would go stale
  with it, with nothing reporting either. The new gate ⑮ re-runs the report's
  own generation recipe (4 themes × 6 player tiers × 1000 games = 24,000 games)
  into a **temporary file** and compares it byte-for-byte against the committed
  report (tolerance 0, line endings normalised). Any drift is red and names the
  differing lines. The comparison surface is deliberately a *separate* run:
  regenerating the committed report in place would always compare equal and make
  the gate permanently green. The tolerance was not guessed — three independent
  runs (twice regenerated plus the committed copy) produced identical SHA256
  digests, which is what makes a zero tolerance defensible. Resident negative
  samples cover both the comparison logic and the whole gate end-to-end
  (isolated copy: change one line of engine → gate exits 1 → restore → exits 0).
  The gate also checks the **sample scope** against two independent
  authorities: the sample size stated in the specification (§9.2: 4 themes ×
  6 tiers × 1000 games = 24,000 games, with the theme count taken from the
  actual theme packs and the tier count from the scale table), and the game
  count the simulator actually reported on stdout. Comparing the two reports
  against each other would have been a tautology: changing the simulator's
  defaults *and* regenerating the report would shrink the sample silently
  while both sides still compared equal. The stdout count matters on its own
  because the scope lines inside the report are written by the report
  generator and can be hard-coded to any value — the actual count cannot.
- The gate count is now a **literal** (`15`) asserted against the gate list,
  instead of being derived from the list itself — the previous form compared
  a value with itself and could never fail.

### Fixed

- Closed the R8 balance follow-up after re-measuring it. The opening-bonus identity
  sits only +5.1 to +7.3pp above uniform across three independent seed bases
  (18,000 games per identity), below the 15pp record line, so no rebalancing is
  applied. The measurably weaker family is now the resource-stealing one
  (-3.5 to -3.9pp), registered as an observation instead.

- Fixed two ways the physical board could mislead players: degraded gates (gates
  beyond a player-count tier's gate budget) still printed the "过路 N" toll the
  engine does not recognise, and the board PDF was forced to A4 although the
  stylesheet asks for A3 landscape. The board page is now A3 landscape and the
  rest A4 portrait. Gate ⑦ gained a fifth level comparing the entity boards
  against the scale table, with resident negative samples.
- The README's "known limitations" section no longer hand-copies balance readings
  that had silently gone stale; a resident guard now fails if any
  `number + pp/%` reading is pasted back in.
- The simulation harness can now be given a `FacePolicy` module through
  `--policy-module` (default off). With it off the simulation output is
  byte-identical to before; a resident guard covers the default / fallback /
  throwing / actually-applied states.

- Fixed the Dependabot auto-merge workflow mis-classifying **major** updates as
  patch/minor. The check only looked for a `deps-major` group name in the pull
  request title, and Dependabot never writes that name for ungrouped major updates
  — four real major pull requests had reached the merge queue. The classifier now
  compares the major version numbers in the pull request's `from … to …` range and
  treats grouped pull requests conservatively (manual review).
- Added `deps-major` groups to every update target in `.github/dependabot.yml` so
  Dependabot labels major updates itself, plus a resident guard
  (`tests/gates/dep-update-classify.test.ts`) that runs the workflow's own classifier
  against the real pull request titles seen in this repository.

### Added

- `AGENTS.md` — the entry point for agents and collaborators: the non-negotiable
  rules, where each rule's detail lives, the batch protocol, and the authorisation
  boundary for externally visible actions.
- `CLAUDE.md` — a thin pointer to `AGENTS.md` (no duplicated rules).
- `ROADMAP.md` — released / in-flight / open follow-ups, derived from the repo's
  own records rather than from a separate plan.
- A resident guard (`tests/gates/entry-docs.test.ts`) that fails when a documented
  pointer points at a file that does not exist.

### Security

- Upgraded the build chain's `esbuild` from 0.24.2 to 0.28.2, fixing GHSA-67mh-4wv8-2f99.
  The single-file build output is byte-identical (SHA256 `80E5DA2E…`, 212,032 bytes).
- Pinned the host prototype's transitive `katex`, `i18next` and `diff` above their
  vulnerable ranges with npm `overrides`, fixing GHSA-238p-pmpm-9mq7, GHSA-6jcc-5g8w-32mx
  and GHSA-73rr-hh4g-fpgx. Their upstream provider (`sparkdesign@0.4.11`) has not released
  a fixed dependency range, so the overrides are the only available path.

## [0.1.0] - 2026-11-25

First public release: the complete 2026 remake of the board game `创界山` (from
《爱情公寓 3》), covering the rules engine, the four theme packs, the digital
track (single-file offline HTML), the physical track (printable PDF / SVG), and
the quality pipeline that keeps both tracks in sync.

### Added

**Rules engine (`engine/`)**
- Immutable state, turn machine, 58 operators, 16 predicates and 8 win conditions.
- The full `活人认证` (living-certification) loop: sign / challenge / appeal /
  compliance check / two-round limit / mutual verification / seal halving.
- `山议` (council) with an exile floor of 3, plus the five negative-status
  operators (poison / slow / silence / skip-turn / immunity) and 力竭 (exhaustion).
- `AI 补位` support: seats may be marked as AI-controlled and are refused
  certification actions at the engine level.

**Theme packs (`themes/`)**
- Four interchangeable themes sharing one schema: 仙侠·2026 (baseline),
  科幻·AI 纪元, 融合·道械双修, 都市·异能纪. Each ships its own resources,
  identities, factions, cards, certification questions and trials.
- A single 18-leaf terminology contract (`terms`) so that no sentence in the
  engine or the UI hard-codes one theme's words.

**Digital track (`web/`)**
- A single-file, offline, double-click-to-play HTML build (engine + UI + theme
  data inlined).
- A separate React + Vite host prototype for the broadcast-console view (four
  flows: live board, certification climax, settlement ranking, setup).

**Physical track (`build/`, `print/`)**
- Theme → IR → SVG → HTML → PDF pipeline producing the rulebook, board, 48 cards,
  8 identity cards, 4 faction cards, certification question cards and chips.
- Every number in the rulebook's scale tables carries a machine-readable
  provenance marker back to `engine/scales.ts`.

**Quality pipeline (`tools/`, `tests/`)**
- Fourteen gates behind one entry point (`npm run gate`): types, tests, doc
  drift, build, theme validation, IR contract, dual-track parity, theme
  differentiation, scale & balance simulation, browser end-to-end, trial pass
  rate, position-spread regression, reserve-threshold regression, and a browser
  walkthrough that asserts the UI's own contract.
- Resident negative samples: every gate must be able to go red on a deliberate
  defect and green again after recovery.
- A clean-room self-check that runs the whole gate chain inside an isolated copy
  without pre-built artifacts.

**Balance**
- Deterministic multi-seed simulations with published baselines; position
  spread, win-rate spread and trial pass rates are locked by regression gates.
- The design goal "登顶不是胜利" is enforced by measurement: first-to-peak win
  rate fell from ~77% to 17–35%.

### Documentation
- Specification, batch records, gate catalogue and a lesson index (E1–E147) in
  `docs/`, in Chinese.

[Unreleased]: https://github.com/1273984347/creativemountain-liveness/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/1273984347/creativemountain-liveness/releases/tag/v0.1.0
