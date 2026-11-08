"""Weighted Whittaker smoother (ADR-0007 D6): second-order differences, daily grid, lambda = 500.

z = argmin  sum_t w_t (y_t - z_t)^2 + lam * sum_t (Δ² z_t)^2   ->   (W + lam DᵀD) z = W y

The system is symmetric positive definite and pentadiagonal, solved with scipy's banded Cholesky
(solveh_banded). Implemented with numpy/scipy (ADR-0007 rejects vam.whittaker / modape).
"""

from __future__ import annotations

import numpy as np
from scipy.linalg import solveh_banded

LAMBDA = 500.0
MIN_OBS = 3


def _dtd_upper_bands(n: int, lam: float) -> np.ndarray:
    """lam * DᵀD in upper banded form (3, n) for solveh_banded (row 2 = main diagonal)."""
    d = np.zeros((n - 2, n))
    idx = np.arange(n - 2)
    d[idx, idx] = 1.0
    d[idx, idx + 1] = -2.0
    d[idx, idx + 2] = 1.0
    dtd = d.T @ d if n <= 2000 else None
    if dtd is None:  # pragma: no cover - windows are ~430 days
        raise ValueError("series too long")
    ab = np.zeros((3, n))
    ab[2] = np.diag(dtd)
    ab[1, 1:] = np.diag(dtd, 1)
    ab[0, 2:] = np.diag(dtd, 2)
    return lam * ab


def smooth(y: np.ndarray, w: np.ndarray, lam: float = LAMBDA, _bands: np.ndarray | None = None) -> np.ndarray:
    """Smooth one series. y may contain NaN where w == 0. Returns NaN everywhere when fewer than
    MIN_OBS weighted observations exist (nothing is invented)."""
    y = np.asarray(y, dtype=float)
    w = np.asarray(w, dtype=float).copy()
    w[~np.isfinite(y)] = 0.0
    n = y.size
    if n < 3 or (w > 0).sum() < MIN_OBS:
        return np.full(n, np.nan)
    ab = (_bands if _bands is not None else _dtd_upper_bands(n, lam)).copy()
    ab[2] += w
    return solveh_banded(ab, np.where(w > 0, w * np.nan_to_num(y), 0.0), check_finite=False)


def smooth_stack(y: np.ndarray, w: np.ndarray, lam: float = LAMBDA) -> np.ndarray:
    """Smooth many series at once: y, w shaped (T, P). Each column is solved independently."""
    t, p = y.shape
    out = np.full((t, p), np.nan)
    if t < 3:
        return out
    bands = _dtd_upper_bands(t, lam)
    for j in range(p):
        out[:, j] = smooth(y[:, j], w[:, j], lam, bands)
    return out
