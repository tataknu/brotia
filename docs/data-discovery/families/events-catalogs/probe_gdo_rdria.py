"""GDO RDrI-Agri (Risk of Drought Impact for Agriculture) keyless probe.
1-degree, dekadal, 2010-present, ~270 KB/yr netCDF4. Reads cell values at farms.
Needs h5py (not in project venv; run with PYTHONPATH to a scratch install)."""
import sys, datetime, tempfile, h5py, numpy as np
from farms import FARMS
B="https://drought.emergency.copernicus.eu/data/Drought_Observatories_datasets/GDO_Risk_of_Drought_Impacts_for_Agriculture/"
fn=sys.argv[1] if len(sys.argv)>1 else None
if not fn:
    import requests; fn=tempfile.mktemp(suffix='.nc'); open(fn,'wb').write(requests.get(B+"ver4-0-1/rdria_m_gdo_20260101_20261011_t.nc",timeout=120).content)
f=h5py.File(fn,'r'); lat=f['lat'][:]; lon=f['lon'][:]; t=f['time'][:]; v=f['rdria'][:,0,:,:]
base=datetime.date(*map(int,f["time"].attrs["units"].decode().split("since ")[1][:10].split("-")))
cells=sorted(set((int(np.abs(lat-x['lonlat'][1]).argmin()),int(np.abs(lon-x['lonlat'][0]).argmin())) for x in FARMS))
print("cells",[(float(lat[i]),float(lon[j])) for i,j in cells])
for k in range(len(t)):
    vals=[None if np.isnan(v[k,i,j]) else round(float(v[k,i,j]),2) for i,j in cells]
    print(base+datetime.timedelta(days=int(t[k])), vals)
