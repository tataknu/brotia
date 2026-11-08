"""Type-check every fixture against contracts/v1/types.ts with strict tsc.

Each fixture is embedded as a typed object literal, so literal unions and excess properties are checked.
Uses the app's TypeScript and @types/geojson. Writes only to a temp directory. Exit 0 = all fixtures conform.
Run: python3 contracts/v1/tools/check_fixtures.py
"""
import json, os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
V1 = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(V1))
FIX = os.path.join(V1, "fixtures")
TSC = os.path.join(ROOT, "app", "node_modules", ".bin", "tsc")
GEOJSON = os.path.join(ROOT, "app", "node_modules", "@types", "geojson", "index.d.ts")

TYPES = {
    "countries.json": "T.Country[]", "crops.json": "T.CropTemplate[]", "portfolio-sample.json": "T.Portfolio",
    "assessment-portfolio.json": "T.PortfolioAssessment", "assessment-farm-cl-ovalle-table-grape.json": "T.FarmAssessment",
    "imagery-cl-ovalle-table-grape.json": "T.ImageryTimeline", "events.json": "T.ClimateEvent[]",
    "agent-recommendation.json": "T.AgentRecommendation", "health.json": "T.Health",
    "ciren-orchards.json": "T.CirenOrchardCollection", "manifest.json": "T.SnapshotManifest", "errors.json": "T.ApiError[]",
}

missing = set(os.listdir(FIX)) ^ set(TYPES)
if missing:
    sys.exit(f"fixture list mismatch: {sorted(missing)}")

tmp = tempfile.mkdtemp(prefix="contract-check-")
try:
    shutil.copy(os.path.join(V1, "types.ts"), os.path.join(tmp, "types.ts"))
    lines = ["import type * as T from './types';"]
    for i, (name, t) in enumerate(TYPES.items()):
        with open(os.path.join(FIX, name), encoding="utf-8") as f:
            json.load(f)  # valid JSON first
            f.seek(0)
            lines.append(f"// {name}\nexport const f{i}: {t} = {f.read()};")
    with open(os.path.join(tmp, "check.ts"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    with open(os.path.join(tmp, "tsconfig.json"), "w") as f:
        json.dump({"compilerOptions": {"strict": True, "noEmit": True, "target": "ES2020", "module": "ESNext",
                                       "moduleResolution": "bundler", "skipLibCheck": True, "paths": {"geojson": [GEOJSON]}},
                   "files": ["check.ts"]}, f)
    r = subprocess.run([TSC, "-p", os.path.join(tmp, "tsconfig.json")], capture_output=True, text=True)
    print(r.stdout or "all fixtures conform to types.ts")
    sys.exit(r.returncode)
finally:
    shutil.rmtree(tmp, ignore_errors=True)
