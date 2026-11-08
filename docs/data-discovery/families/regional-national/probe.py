"""Probe script for the regional-national family (2026-11-06).

Run: /Users/cristian/Documents/projects/energhack/.venv/bin/python probe.py
Writes small sample JSON/TXT files next to this script. No credentials used.

Key gotcha: dashboard.crc-sas.org serves only its leaf certificate (missing the
Sectigo DV R36 intermediate), so python-requests + certifi fails with
CERTIFICATE_VERIFY_FAILED. We fetch the intermediate from the AIA URL once and
build a CA bundle = certifi + intermediate. (curl on macOS works out of the box.)
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import tempfile
import time

import certifi
import requests

HERE = pathlib.Path(__file__).parent
SISSA = "https://dashboard.crc-sas.org/api-sissa/v0.1.0"
SMN = "https://ssl.smn.gob.ar/dpd/descarga_opendata.php?file="
INTERMEDIATE_URL = "http://crt.sectigo.com/SectigoPublicServerAuthenticationCADVR36.crt"
FARM = {"name": "Estancia Los Tajibos", "lon": -62.52, "lat": -16.86}


def ca_bundle() -> str:
    """certifi bundle + Sectigo DV R36 intermediate (DER -> PEM via openssl)."""
    der = requests.get(INTERMEDIATE_URL, timeout=30).content
    pem = subprocess.run(
        ["openssl", "x509", "-inform", "DER", "-outform", "PEM"],
        input=der, capture_output=True, check=True,
    ).stdout.decode()
    f = tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False)
    f.write(pathlib.Path(certifi.where()).read_text() + "\n" + pem)
    f.close()
    return f.name


def get(url: str, verify, save: str | None = None):
    t = time.time()
    r = requests.get(url, timeout=90, verify=verify)
    dt = time.time() - t
    print(f"{r.status_code} {dt:5.2f}s {len(r.content):>8}B {url}")
    if save and r.ok:
        (HERE / save).write_bytes(r.content)
    return r


def main() -> None:
    verify = ca_bundle()

    # --- CRC-SAS / SISSA public dashboard API (no auth) ---
    get(f"{SISSA}/selectores/max-fecha-con-datos", verify)
    get(f"{SISSA}/selectores/estaciones/BO", verify, "sample_crcsas_stations_BO.json")
    # Station drought events (SPI-3 < -1, from SENAMHI Bolivia gauge record)
    get(f"{SISSA}/informes/indices-sequia/eventos-estacion/BO/85245/spi/3/seco/-1.0/6",
        verify, "sample_trompillo_spi3_dry_events.json")
    # Station SPI-3 latest summary (null for BO since ~Mar 2025)
    get(f"{SISSA}/informes/indices-sequia/resumen/BO/85244/3", verify)
    # Gridded products sampled at a farm point (365-day window)
    lon, lat = FARM["lon"], FARM["lat"]
    get(f"{SISSA}/informes/grace/comparar/rtzsm_inst/2026-11-02/2025-11-03/{lon}/{lat}",
        verify, "sample_grace_rtzsm_pct_tajibos.json")
    get(f"{SISSA}/informes/smap/comparar/soil_moisture_am/2026-10-31/2025-10-31/{lon}/{lat}",
        verify, "sample_smap_sm_tajibos.json")
    # Province-level MODIS NDVI with climatology + anomaly (Ignacio Warnes = 630)
    get(f"{SISSA}/informes/indices-vegetacion/escala-local/series-temporales/BO/545/630/ndvi",
        verify, "sample_ndvi_warnes_province.json")
    get(f"{SISSA}/informes/indices-cdi/resumen/BO/85244", verify)

    # --- SMN Argentina open data (no auth): daily Tmax/Tmin for yesterday ---
    get(f"{SMN}observaciones/obs20261105.txt", True, "sample_smn_obs_20261105.txt")


if __name__ == "__main__":
    main()
