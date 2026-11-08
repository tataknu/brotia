"""Throughput test: CHIRPS v3 daily rnl COGs (512x512 tiles) - read all 12 farms from 20 consecutive days, paced.
Decides whether a keyless CHIRPS v3 daily baseline build from CHC is viable."""
import time, rasterio
from rasterio.env import Env
farms = [(-62.52,-16.86),(-62.7,-16.97),(-62.47,-17.3),(-62.55,-17.38),(-62.68,-17.56),(-62.76,-17.74),(-62.85,-17.18),(-62.93,-17.27),(-63.29,-17.2),(-63.21,-17.29),(-63.08,-17.56),(-63.18,-17.03)]
t_all = time.time(); errs = 0; tot = [0.0]*12
with Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="3", GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES"):
    for d in range(1, 21):
        u = f"/vsicurl/https://data.chc.ucsb.edu/products/CHIRPS/v3.0/daily/final/rnl/cogs/2024/chirps-v3.0.rnl.2024.01.{d:02d}.cog"
        t0 = time.time()
        try:
            with rasterio.open(u) as ds:
                v = [float(x[0]) for x in ds.sample(farms)]
                if d == 1: print("tiled", ds.profile.get("tiled"), ds.block_shapes[0], ds.shape)
            tot = [a + b for a, b in zip(tot, v)]
            print(d, f"{time.time()-t0:.2f}s", round(v[0], 1), flush=True)
        except Exception as e:
            errs += 1; print(d, "ERR", str(e)[:80])
        time.sleep(0.5)
print(f"20 files in {time.time()-t_all:.0f}s, errors={errs}; Jan1-20 2024 totals per farm:", [round(x) for x in tot])
