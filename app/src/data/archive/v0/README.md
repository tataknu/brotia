# v0 archive (not compiled, not tested, not used)

The v0 app (fake deterministic engine, Bolivian soy belt, v0 domain types) moved here when v1 started
(2026-11-07). It is excluded from `tsconfig.json` and `vitest.config.ts`. Nothing in `src/` may import
from this folder. Feature owners may read and copy pieces (for example the wizard's polygon drawing in
`features/wizard/farms/`, the loan schedule step in `features/wizard/credit/`, chart layouts in
`features/farm/`), adapting them to the v1 types in `src/domain/types.ts`.
