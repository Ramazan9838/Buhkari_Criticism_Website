#!/bin/sh
# Birleşmiş dalları uzak depodan siler (.github/workflows/dal-temizligi.yml çağırır).
# Kullanım:
#   sh .github/dal_temizle.sh pr DAL      PR birleşti: o PR'ın dalı silinir (squash birleştirmede de)
#   sh .github/dal_temizle.sh toplu       main'in tamamen içinde olan bütün dallar silinir
# DENEME=1 verilirse hiçbir şey silinmez, yalnız listelenir.
# Hiçbir zaman silinmeyenler: main, ortak-kayit (bilgisayarlar arası ortak kayıt verisi).
set -eu
KORUNAN='^(main|ortak-kayit)$'
kip=${1:-}
DENEME=${DENEME:-0}

git fetch --quiet --prune origin '+refs/heads/*:refs/remotes/origin/*'

sil() {
  if [ "$DENEME" = "1" ]; then echo "silinecekti: $1"; else git push --quiet origin --delete "$1" && echo "silindi: $1"; fi
}

case "$kip" in
  pr)
    dal=${2:-}
    if [ -z "$dal" ]; then echo "PR dalı verilmedi"; exit 2; fi
    if echo "$dal" | grep -Eq "$KORUNAN"; then echo "korunan dal, dokunulmadı: $dal"; exit 0; fi
    if ! git rev-parse -q --verify "refs/remotes/origin/$dal" >/dev/null; then echo "dal zaten yok: $dal"; exit 0; fi
    sil "$dal"
    ;;
  toplu)
    silinen=0; kalan=0
    for ref in $(git for-each-ref --format='%(refname:short)' refs/remotes/origin); do
      dal=${ref#origin/}
      [ "$dal" = "HEAD" ] && continue
      [ "$ref" = "origin" ] && continue
      if echo "$dal" | grep -Eq "$KORUNAN"; then continue; fi
      if git merge-base --is-ancestor "$ref" refs/remotes/origin/main; then
        sil "$dal"; silinen=$((silinen + 1))
      else
        echo "korundu (main'de olmayan commit'i var): $dal"; kalan=$((kalan + 1))
      fi
    done
    echo "Özet: $silinen dal $( [ "$DENEME" = "1" ] && echo 'silinecekti' || echo 'silindi'), $kalan dal korundu."
    ;;
  *)
    echo "Kullanım: sh .github/dal_temizle.sh pr DAL | toplu"; exit 2 ;;
esac
