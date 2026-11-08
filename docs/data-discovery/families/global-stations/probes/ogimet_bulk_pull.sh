#!/bin/bash
# DEPRECATED: use ogimet_fill_months.sh. Quarter and year requests truncate under load
# (2004 full year stopped at 27 Apr; 2025-Q2 stopped at 30 Apr; 2024-Q4 returned 1 bulletin).
# Kept only as a record of what was tried.
# usage: ogimet_bulk_pull.sh 85244 2000 2026 OUTDIR
st=$1; y0=$2; y1=$3; out=$4; mkdir -p "$out"
for y in $(seq $y0 $y1); do
  for q in 01 04 07 10; do
    case $q in 01) e="${y}04010000";; 04) e="${y}07010000";; 07) e="${y}10010000";; 10) e="$((y+1))01010000";; esac
    f="$out/og_${st}_${y}${q}.txt"
    [ -s "$f" ] && grep -q "^$st" "$f" && continue
    for attempt in 1 2 3; do
      curl -s -m 120 -A "energhack-research/0.1" -o "$f" -w "$y-$q try$attempt %{http_code} %{time_total}s %{size_download}B\n" \
        "https://www.ogimet.com/cgi-bin/getsynop?block=$st&begin=${y}${q}010000&end=$e"
      head -c 120 "$f" | grep -q "^$st" && break
      echo "non-data reply: $(head -c 150 "$f")"; sleep 60
    done
    sleep 15
  done
done
echo DONE
