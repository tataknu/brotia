"""FIRMS keyless probe. Streams yearly country CSV (MODIS C6.1 standard/NRT archive)
and the 7-day South America VIIRS NRT file; filters detections within 25 km of farms.
No key used. Saves only a small filtered CSV."""
import io, time, math, requests, pandas as pd
from farms import FARMS
def near(df, km=25):
    out=[]
    for f in FARMS:
        lo,la=f["lonlat"]
        d=111.32*((df.latitude-la)**2+((df.longitude-lo)*math.cos(math.radians(la)))**2)**0.5
        sub=df[d<=km].copy(); sub["farm"]=f["name"]; sub["dist_km"]=d[d<=km].round(1); out.append(sub)
    return pd.concat(out)
urls={"modis_2024_BOL":"https://firms.modaps.eosdis.nasa.gov/data/country/modis/2024/modis_2024_Bolivia.csv",
      "modis_2025_BOL":"https://firms.modaps.eosdis.nasa.gov/data/country/modis/2025/modis_2025_Bolivia.csv",
      "viirs_snpp_SA_7d":"https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_South_America_7d.csv"}
allnear=[]
for k,u in urls.items():
    t=time.time(); r=requests.get(u,timeout=180); el=round(time.time()-t,1)
    df=pd.read_csv(io.BytesIO(r.content))
    print(k,r.status_code,el,"s",len(r.content)//1024,"KB rows",len(df),"cols",list(df.columns)[:14])
    print("  date range",df.acq_date.min(),df.acq_date.max(), "types" , df["type"].value_counts().to_dict() if "type" in df else "")
    n=near(df); n["src"]=k; allnear.append(n)
    print("  detections <=25km of any farm:",len(n), n.groupby("farm").size().sort_values(ascending=False).head(12).to_dict())
    if len(n): print("  by month:", n.assign(m=n.acq_date.str[:7]).groupby("m").size().to_dict())
pd.concat(allnear).to_csv("firms_near_farms_sample.csv",index=False)
