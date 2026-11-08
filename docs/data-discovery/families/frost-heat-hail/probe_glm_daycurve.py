"""GLM diurnal scan: 1 x 20-s LCFA file per UTC hour over a storm day, flashes in the portfolio bbox (all / quality==0)."""
import requests, re, h5py, io, json, sys
B = "https://noaa-goes19.s3.amazonaws.com/"; BOX = (-63.6, -18.0, -62.2, -16.6)
OUT = "/Users/cristian/Documents/projects/energhack/docs/data-discovery/families/frost-heat-hail/samples/"
out = {}
for ydoy in sys.argv[1:]:
    tot_mb, curve = 0, []
    for hh in range(24):
        keys = re.findall(r"<Key>(.*?)</Key>", requests.get(B, params={"list-type": "2", "prefix": f"GLM-L2-LCFA/{ydoy}/{hh:02d}/", "max-keys": 200}, timeout=60).text)
        if not keys: curve.append(None); continue
        c = requests.get(B + keys[len(keys) // 2], timeout=60).content; tot_mb += len(c) / 1e6
        f = h5py.File(io.BytesIO(c), "r")
        def g(n):
            a = f[n][:].astype(float); at = f[n].attrs
            return a * float(at["scale_factor"][0]) + float(at["add_offset"][0]) if "scale_factor" in at else a
        la, lo, q = g("flash_lat"), g("flash_lon"), f["flash_quality_flag"][:]
        m = (lo >= BOX[0]) & (lo <= BOX[2]) & (la >= BOX[1]) & (la <= BOX[3])
        curve.append((int(m.sum()), int((m & (q == 0)).sum())))
    out[ydoy] = curve; print(ydoy, "MB=%.1f" % tot_mb, "per-hour (all, q0):", curve)
json.dump(out, open(OUT + "glm_daycurve_portfolio_bbox.json", "w"))
