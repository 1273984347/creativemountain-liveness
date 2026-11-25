<!-- Pull request template maintained by the project maintainers; scope: every change to the repository. -->

## Summary

<!-- What changed, in behaviour terms. Not a file list. -->

## Why

<!-- The problem this solves and the alternative you rejected. -->

## Batch

<!-- Rules, thresholds and gate criteria are changed through a batch — see CONTRIBUTING.md §5.
     Leave empty for documentation-only changes. -->

- Batch number:
- Plan / specification:
- Execution record: `docs/批次/<record>.md`

## How it was verified

<!-- Paste the ACTUAL output of the commands you ran. Numbers, not adjectives.
     The full gate chain is the contract: npm run gate must be green. -->

```
npm run gate
```

<!-- If the change touches the specification ↔ code contract, include doc-sync: -->

```
npm run doc-sync
```

<!-- If the change touches balance, include the measurement and its before/after values. -->

## Negative samples

<!-- Required for any new or changed guard (gate, validator, assertion).
     What did you break, and what red output proves the guard reacted?
     Also include the positive sample: the same check green when restored. -->

- Broken:
- Red output:
- Restored / green output:

## Checklist

- [ ] `npm run gate` passes locally (14/14) and the output is pasted above
- [ ] New guards have a resident negative sample (violate ⇒ red, restore ⇒ green)
- [ ] Specification and code agree (`npm run doc-sync`, C1–C10)
- [ ] Gate catalogue (`docs/沉淀/门禁清单.md`) and the root `README.md` gate table updated if gate behaviour changed
- [ ] Theme content changed → the parity gate (digital ↔ physical) still passes
- [ ] Committed with explicit pathspec (no `git add -A`, no `git commit -a`)
- [ ] Generated output (`dist/`, `print/`) not committed
- [ ] `.gitattributes` line endings respected (LF)
- [ ] AI assistance disclosed (see CODE_OF_CONDUCT.md)
