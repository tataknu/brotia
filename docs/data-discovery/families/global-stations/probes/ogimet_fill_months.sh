#!/bin/bash
# Fill months that are missing or truncated (< MIN bulletins) with one-month OGIMET requests.
# Quarter/year requests get truncated when the server is slow (~50 s cap), so months are the safe unit.
# usage: ogimet_fill_months.sh 85244 2024-10 2026-11 OUTDIR [MIN=150]
st=$1; from=$2; to=$3; out=$4; min=${5:-150}
cur=$from
while [[ "$cur" < "$to" || "$cur" == "$to" ]]; do
  y=${cur%-*}; m=${cur#*-}
  have=$(cat "$out"/og_${st}_*.txt 2>/dev/null | grep -c "^$st,$y,$m,")
  if [ "$have" -lt "$min" ]; then
    ny=$y; nm=$((10#$m + 1)); [ $nm -gt 12 ] && { nm=1; ny=$((y+1)); }
    nm=$(printf %02d $nm)
    f="$out/og_${st}_${y}${m}_m.txt"
    curl -s -m 120 -A "energhack-research/0.1" -o "$f" -w "$cur had=$have %{http_code} %{time_total}s %{size_download}B" \
      "https://www.ogimet.com/cgi-bin/getsynop?block=$st&begin=${y}${m}010000&end=${ny}${nm}010000"
    echo " got=$(grep -c "^$st,$y,$m," "$f")"
    sleep ${OG_SLEEP:-15}
  fi
  nm=$((10#$m + 1)); ny=$y; [ $nm -gt 12 ] && { nm=1; ny=$((y+1)); }
  cur="$ny-$(printf %02d $nm)"
done
echo DONE
