# ADR-0015: Super-resolution model: SEN2SRLite, display only, with a labelled fallback

- **Status:** Accepted
- **Date:** 2026-11-07
- **Builds on:** ADR-0013 D8 (imagery: interpolation + AI super-resolution, trust rule), CONTRACT §E.12
- **Decided by:** the svc-superres builder after the time-boxed evaluation that ADR-0013 D8 asked for

## Context

ADR-0013 D8 left the model open: an open, pretrained Sentinel-2 super-resolution model that takes
frames from 10 m to about 2.5 m for display, chosen by quality, speed on an Apple-silicon laptop and licence,
with plain resampling as the labelled fallback. The demo must also run offline.

## Decisions

### D1. Model: SEN2SRLite `NonReference_RGBN_x4`

- **What:** ESA OpenSR / IPL-UV SEN2SRLite, RGB + NIR input, ×4 (10 m → 2.5 m).
- **Licence:** CC0-1.0 for both code and weights.
- **Speed:** 0.07 s on MPS and 0.3 s on CPU per 256 × 256 chip.
- **Fidelity:** it has a hard constraint that keeps the output consistent with the 10 m input once averaged back, and it is a
  CNN, not a GAN, so it invents less texture.
- **Hardware:** no CUDA needed.

| Rejected | Reason |
|---|---|
| Full SEN2SR (Mamba) | Install instructions need `mamba-ssm` CUDA kernels |
| Satlas super-resolution | Weights licence not confirmed; multi-image GAN (8 or 16 images per output) trained on US NAIP |
| DSen2 | GPL-3.0, and it only upscales 20 m bands to 10 m |

### D2. Weights are vendored, remote code is never run

- The weights are stored under `service/app/superres/weights/` so the demo works offline.
- The model is built from the `sen2sr` classes; the downloaded remote `load.py` is never executed.
- The one-time download (4 small files from Hugging Face) went through `mlstac`, which used its own default User-Agent and
  bypassed the service cache. Nothing was spoofed and it is not repeated at run time. Recorded for ADR-0012 honesty.

### D3. AI runs only on observed frames

- Observed frames have the RGBN bands, so they get AI super-resolution (`srKind: 'ai'`).
- Interpolated frames have NDVI only, so they get Lanczos ×4 and the label **"Resampled, not AI"** (`srKind: 'resampled'`).
- `srKind` is set per frame. The app's toggle reads "Enhanced" when the timeline mixes kinds, and the per-frame badge and the
  caption say which kind each frame is.
- This narrows ADR-0013 D8, which spoke of upscaling "frames" in general.

### D4. Fallback ladder with a recorded reason

AI on MPS → AI on CPU → Lanczos ×4. Each step records why it fell back. `CLM_SR_DISABLE=1` forces the fallback and
`CLM_SR_DEVICE` pins the device. `/health` reports `ai` while the model can be loaded and switches to `resampled` only after a
real load failure (unless `warm()` ran at startup).

### D5. Trust rule by design

- SR arrays are labelled `display_only` and are never read by any metric.
- **Why this is structural, not a preference:** the hard constraint only guarantees agreement after averaging back to 10 m. Each
  2.5 m value is model output, not a measurement.

### D6. Implementation details

Fixed 128 px tiles (the hard-constraint mask is fixed at 512 × 512) with a 32 px feathered overlap; small farm chips are
edge-padded; output reflectance is clamped at 0; the in-memory LRU cache is capped at 64 entries and 256 MB; one inference lock
guards the shared MPS model.

## Consequences

- ADR-0013 D8's AI step is met without a CUDA machine, a paid licence or a network call at run time.
- The MPS path is covered by the evaluation run, not by tests (tests pin `CLM_SR_DEVICE=cpu` for determinism).
- Satlas and full SEN2SR remain options for v2 if a CUDA machine and a confirmed licence are available.
