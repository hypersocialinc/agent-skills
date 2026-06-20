#!/usr/bin/env bash
# Scaffold a diligence data room: numbered folder tree + index README + status checklist.
# Creates structure and templates only — you populate the documents.
# Usage: ./scaffold-dataroom.sh [target-dir]   (default: ./dataroom)
set -euo pipefail

ROOT="${1:-./dataroom}"

if [ -e "$ROOT" ] && [ -n "$(ls -A "$ROOT" 2>/dev/null || true)" ]; then
  echo "Refusing to scaffold: '$ROOT' already exists and is not empty." >&2
  exit 1
fi

# section key|title
SECTIONS=(
  "00_Index_and_Overview|Index, company overview, and this checklist"
  "01_Corporate|Formation docs, bylaws/charter, board + stockholder consents, good-standing"
  "02_Capitalization|Cap table, option ledger, SAFEs/notes, equity plan, 409A, side letters"
  "03_Financials|Statements, financial model, AR/AP, bank statements, debt/loan docs"
  "04_Intellectual_Property|IP assignments, patents, trademarks, domains, OSS inventory, licenses"
  "05_Commercial|Customer contracts, partnerships, MSAs, top revenue agreements, pipeline"
  "06_People_HR|Offer letters, IP/PIIA, contractor agreements, org chart, comp, benefits"
  "07_Legal_Compliance|Litigation/claims, regulatory, permits, insurance, corporate policies"
  "08_Tax|Returns, R&D credits, state nexus/registrations, tax notices"
  "09_Product_Technology|Architecture, roadmap, security/pen-test reports, infra/vendors, SLAs"
  "10_Data_Privacy_Security|Privacy policy, DPAs, data inventory, GDPR/CCPA posture, breach history"
)

mkdir -p "$ROOT"

README="$ROOT/00_Index_and_Overview/README.md"
CHECKLIST="$ROOT/00_Index_and_Overview/CHECKLIST.md"

{
  echo "# Data room — index"
  echo
  echo "Curate, don't dump. Stage disclosure: low-sensitivity in Tier 1; crown jewels (customer names, source code, salary detail, security internals) in Tier 2 (post-LOI/exclusivity). Review every document for accuracy before granting access."
  echo
  echo "## Sections"
} > /dev/null  # placeholder; written below after dirs exist

for entry in "${SECTIONS[@]}"; do
  key="${entry%%|*}"
  desc="${entry#*|}"
  mkdir -p "$ROOT/$key"
  # keep empty dirs in git
  : > "$ROOT/$key/.gitkeep"
done

{
  echo "# Data room — index"
  echo
  echo "Curate, don't dump. Stage disclosure: low-sensitivity in Tier 1; crown jewels"
  echo "(customer names, source code, salary detail, security internals) in Tier 2"
  echo "(post-LOI/exclusivity). Review every document for accuracy before granting access."
  echo
  echo "## Sections"
  for entry in "${SECTIONS[@]}"; do
    key="${entry%%|*}"; desc="${entry#*|}"
    echo "- \`$key/\` — $desc"
  done
} > "$README"

{
  echo "# Data room checklist"
  echo
  echo "Status: ✅ have · ⬜ missing · 🔒 hold for Tier 2 · ✂️ needs redaction"
  echo
  echo "**Deal-killers — confirm first:** every IP assignment signed · cap table reconciled · financials tie to the model · no off-cap-table equity promises."
  echo
  for entry in "${SECTIONS[@]}"; do
    key="${entry%%|*}"; desc="${entry#*|}"
    echo "## $key"
    echo "_$desc_"
    echo
    echo "- [ ] ⬜ "
    echo
  done
} > "$CHECKLIST"

echo "Scaffolded data room at: $ROOT"
echo "  - $README"
echo "  - $CHECKLIST"
echo "Next: populate documents, mark checklist status, and set up a real VDR for buyer access."
