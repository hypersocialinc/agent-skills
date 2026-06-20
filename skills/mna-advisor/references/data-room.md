# Building the data room (a.k.a. deal room / VDR)

How to actually stand up the diligence room — structure, checklist, and staged disclosure. For *why* it matters and the deal-killers it surfaces (IP-assignment gaps, messy cap table), see `./references/diligence-readiness.md`. ("Data room," "deal room," and "VDR" are the same thing for diligence.)

## Two rules that override everything

1. **Curate, don't dump.** Too many documents buries the ones that matter and slows the buyer. Include what's relevant, well-named, and organized — disorganized documentation is a leading cause of failed deals.
2. **Stage the disclosure.** Don't expose the crown jewels in the first tier. Low-sensitivity material goes in early; sensitive material (customer names/contracts, source code, salary detail, security internals) opens later — typically post-LOI / once exclusivity and trust are established.

## Canonical folder structure

```
00_Index_and_Overview/      # README index, one-page company overview, this checklist
01_Corporate/               # formation docs, bylaws/charter, board + stockholder consents, good-standing
02_Capitalization/          # cap table, option ledger, SAFEs/notes, equity plan, 409A, side letters
03_Financials/              # statements, financial model, AR/AP, bank statements, debt/loan docs
04_Intellectual_Property/   # IP assignments (founders/employees/contractors), patents, trademarks, domains, OSS inventory, inbound/outbound licenses
05_Commercial/              # customer contracts, partnerships, MSAs, top revenue agreements, pipeline
06_People_HR/               # offer letters, IP/PIIA agreements, contractor agreements, org chart, comp summary, benefits
07_Legal_Compliance/        # litigation/claims, regulatory, permits, insurance policies, corporate policies
08_Tax/                     # returns, R&D credits, state nexus/registrations, tax notices
09_Product_Technology/      # architecture overview, roadmap, security/pen-test reports, infra/vendors, SLAs
10_Data_Privacy_Security/   # privacy policy, DPAs, data inventory, GDPR/CCPA posture, breach history
```

Adapt to the business (e.g., a hardware co adds supply-chain/manufacturing; a regulated co expands compliance). Keep the numbering — it gives buyers a predictable map.

## Per-section checklist (track status)

Maintain a `CHECKLIST.md` marking each item: ✅ have · ⬜ missing · 🔒 hold for later tier · ✂️ needs redaction. Highest-priority items to confirm exist and are clean (these are the deal-killers): **every IP assignment signed**, **cap table reconciled**, **financials tie to the model**, **no off-cap-table equity promises**.

## Tiering (what opens when)

- **Tier 1 (early / broad):** corporate, cap table summary, financial summary, product overview, redacted/anonymized contracts. Enough to validate the deal without exposing secrets.
- **Tier 2 (post-LOI / exclusivity):** full customer contracts with names, detailed financials, source-code access (often read-only or escrowed), salary-level comp, security internals. Crown jewels last.

## Tooling

- The folder structure above is the **content map** regardless of tool. For actual buyer access, use a real **VDR** (secure virtual data room) so you get per-user access control, audit logs, watermarking, and the ability to revoke. Don't run live buyer diligence out of a plain shared drive.
- **Review every document before granting access** — anything inconsistent with your reps is a credibility and indemnity problem.

## Scaffolding

To create the folder tree + an index README + a status checklist, run `./scripts/scaffold-dataroom.sh [target-dir]` (defaults to `./dataroom`). It only creates structure and templates — you populate the documents.
