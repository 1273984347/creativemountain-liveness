# Creativemountain Liveness (2026 Remake)

> A desktop strategy board game for 3–8 players — **physical + digital, from one
> rules engine**. The core twist: **reaching the peak is not the win.**
>
> [中文文档](README.md) · [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) ·
> [Code of Conduct](CODE_OF_CONDUCT.md) · [Security](SECURITY.md) ·
> [License (GPL-3.0)](LICENSE)

The original `创界山` board game appeared in 《爱情公寓 3》. This is its 2026
remake: a strategy / social-deduction game where the summit only hands out an
*admission ticket* — the real victory belongs to whoever survives the
**living-certification** (`活人认证`).

## Verified environment and explicit non-goals

**What CI actually verifies**: Windows (`windows-latest`) × Node.js 22 × Chromium
(Playwright) — all **sixteen gates** of `npm run gate` pass in that combination.
The CI workflow runs that one combination.

**Explicit non-goals**:

- Linux / macOS are **not verified** — CI runs Windows only;
- the Python sidecar (Laya) is an **optional experiment** (it evaluates AI decision
  policies); it is **not** part of CI and is **not** required to play;
- there is **no** online service, account system or multiplayer server — the digital
  track is a **pure offline single file**;
- balance numbers are relative to the **baselines shipped in this repo** and do not
  apply to other implementations;
- the physical pieces are **generated artifacts** (`print/` and `dist/` are not
  tracked); run `npm run build:print` locally to produce them.

## Highlights

- **One engine, two tracks.** The digital track is a single offline HTML file you
  can double-click; the physical track is a printable PDF/SVG set generated from
  the *same* IR data. A parity gate keeps them consistent.
- **Four interchangeable themes.** 仙侠·2026 (baseline), 科幻·AI 纪元,
  融合·道械双修, 都市·异能纪 — same rules, different resources, identities,
  cards and certification questions.
- **A real certification loop.** Sign / challenge / appeal / compliance check /
  mutual verification, with seals that halve the threshold — and a council
  whose exile floor of 3 keeps the table alive.
- **No theme words in the rules.** All player-visible text resolves terms from an
  18-leaf contract, so a fifth theme can be added without touching sentences.
- **Quality you can run.** `npm run gate` executes sixteen gates (types, tests,
  doc drift, build, theme/IR contracts, parity, balance simulations, browser
  end-to-end, browser UI walkthrough) and exits non-zero on any failure.
- **Measured balance.** Deterministic multi-seed simulations with published
  baselines; `登顶即胜` dropped from ~77% to 17–35% first-to-peak win rate.

## Requirements

- **Node.js ≥ 22** (developed on 22 and 24) and npm.
- Python is **optional** — only for the experimental Laya sidecar used to
  evaluate AI decision policies.

## Quick start

```bash
npm ci
npm run build          # typecheck + bundle the single-file HTML
```

Then open `dist/创界山-活人认证.html` — no server, no network, no install.

To produce the printable physical track:

```bash
npm run build:print     # theme → IR → SVG → HTML → PDF
npm run build:package   # assemble dist/发布包/
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` under strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` |
| `npm test` | Unit tests + resident gate self-checks (`node --test`) |
| `npm run test:gates` | Gate-related tests only |
| `npm run build` | Typecheck + esbuild single-file HTML |
| `npm run build:print` | Regenerate the printable physical track (IR → SVG → HTML → PDF) |
| `npm run build:package` | Assemble `dist/发布包/` |
| `npm run gate` | **The one entry point**: all sixteen gates, any failure ⇒ exit 1 |
| `npm run release:check` | Gate + full re-scan + per-group baseline comparison (~10 min) |
| `npm run doc-sync` | Specification ↔ code drift check (C1–C10) |

## Repository layout

```
engine/     rules engine: state, turn machine, operators, certification, council
web/        digital track UI (no framework, bundled into one HTML file)
themes/     four theme packs (JSON)
build/      theme → IR → SVG/HTML/PDF pipeline and release packaging
tools/      the sixteen gates, theme/IR validators, parity check
tests/      unit tests, resident negative samples, balance simulator
print/      generated physical pieces (git-ignored, regenerated on demand)
docs/       specification, batch records, gate catalogue, lesson index (Chinese)
AGENTS.md   entry point for agents: rule index and where-to-look
CLAUDE.md   thin pointer to AGENTS.md for Claude-based tooling
ROADMAP.md  roadmap: released / in flight / open follow-ups
```

## Documentation

The authoritative design document, the gate catalogue and the batch records live
in `docs/` and are written in **Chinese**; this file is the English entry point.

Start with `AGENTS.md` for the working rules (gate chain, batch protocol, where
everything lives) and `ROADMAP.md` for what is released and what is still open.

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).

The rule engine, themes, tools and documentation in this repository are licensed
under GPL-3.0. Third-party dependencies keep their own licenses (for example the
optional Laya sidecar is Apache-2.0, and the host prototype's `sparkdesign`
package is MIT).

## Acknowledgements

- The original 《创界山》 board game from 《爱情公寓 3》.
- Everyone who has tested a table of eight people and reported that the summit is
  not the win.
