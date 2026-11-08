# contracts/v1 — how to use

1. Read [`CONTRACT.md`](CONTRACT.md): it is binding for names, shapes, endpoints, formulas and folder ownership.
2. [`types.ts`](types.ts) is the normative schema (also inlined in CONTRACT.md §A). The app copies it into `app/src/domain/`; the service mirrors it in pydantic (`service/app/models.py`, camelCase aliases).
3. [`fixtures/`](fixtures/) holds one realistic JSON example per response type (see CONTRACT.md §F). Both sides test against them: the service's responses must validate against the same shapes; the app renders them in tests and before the service is ready.
4. Fixture numbers are illustrative unless a provenance note cites a real source; the scores follow the §E formulas exactly.
5. `fixtures/crops.json` is the seed for the six crop templates (svc-portfolio copies it into `service/data/`).
6. Check fixtures: `python3 contracts/v1/tools/check_fixtures.py` (strict tsc via the app's TypeScript).
7. Regenerate fixtures: `python3 contracts/v1/tools/gen_fixtures.py`; rebuild CONTRACT.md after editing `types.ts` or the template: `python3 contracts/v1/tools/build_contract.py`.
8. Only the contract author edits this folder; request changes through `needs_from_others` (CONTRACT.md §G).
9. Service: `http://localhost:8787`. App dev: `http://localhost:5190`. Offline snapshot: `app/public/snapshot/` (CONTRACT.md §C).
10. Trust rule: every number from native-resolution data, AI pixels display-only, provenance on every value, never invent data.
