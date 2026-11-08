"""Assemble CONTRACT.md from tools/CONTRACT.template.md + types.ts (so §A is always types.ts verbatim).
Run: python3 contracts/v1/tools/build_contract.py
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
V1 = os.path.dirname(HERE)
with open(os.path.join(HERE, "CONTRACT.template.md"), encoding="utf-8") as f:
    tpl = f.read()
with open(os.path.join(V1, "types.ts"), encoding="utf-8") as f:
    types = f.read().rstrip("\n")
assert tpl.count("<<TYPES_TS>>") == 1
with open(os.path.join(V1, "CONTRACT.md"), "w", encoding="utf-8") as f:
    f.write(tpl.replace("<<TYPES_TS>>", types))
print("CONTRACT.md written")
