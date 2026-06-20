# Deal structures — how the money actually works

Reference for step 2 (map money to cap-table reality) and step 3 (size the ask backward).

## The first question: above or below the stack?

Compare **likely clearing price** vs. **total raised / liquidation preference**.

- **Above the stack** (price clears prefs comfortably): common shares have real value; founder proceeds come partly from the equity sale. Cap-gains/QSBS matter a lot here.
- **Underwater** (price below the pref stack): common is effectively worthless in the waterfall. **The acquisition price flows to preferred holders, not the founder.** This changes everything below.

**Confirm which case applies — do not default to underwater.** The underwater playbook is powerful but it talks the headline price *down*; applying it to a borderline-above-stack company needlessly destroys founder value (this is the "anchoring low off a wind-down frame" failure mode, self-inflicted). If the clearing price is unknown:
- Estimate it from comps (e.g., revenue/ARR multiples for the sector, recent same-stage deals), then compare to the total preference.
- If it's genuinely a coin-flip, treat it as **above-stack until proven otherwise** and preserve the headline-price upside — you can always fall back to the carve-out frame, but you can't un-anchor a low number.
- Stress-test a *thin* above-stack margin: escrow/holdback comes out of proceeds (see `./references/deal-mechanics.md`), so a ~10% holdback can quietly push a "slightly above" position back underwater. Check the margin against net-of-holdback proceeds, not the headline.

## The underwater playbook

When the company won't clear its preferences:

- **The acquisition / asset price is not the founder's money.** It exists to (a) get investor *consent* to the transaction / IP transfer, (b) give investors *something* (even if they've written it down), and (c) produce the **"acquired" headline** — the reputation outcome. Treat it as consent-grease, sized to what makes investors say yes, not as founder consideration.
- **The founder's money is the retention + earn-out package**, paid by the acquirer and **carved out around the preference waterfall** — i.e., it does not flow through the cap table. Standard logic: no founder, no deal, so the package sits outside the stack. Investors accept it because the alternative is zero.

## The three consideration buckets (acqui-hire of an underwater company)

A clean template for an underwater company that's still a *real acquisition* (the structure commonly used when a valuable team is bought out of an underwater cap table):

1. **Consideration for investors** — clears consent + gives them something + makes it an *acquisition*. Modest.
2. **Carve-out for founders NOT joining** — paid out separately, outside the waterfall. Skip if there's only one relevant founder.
3. **Retention for founders JOINING** — over ~2 years, often **~50% vesting in year 1** to front-load and create real optionality (walk with half, or stay for the rest).

Anchor on a *named precedent* in the same situation — it de-risks the ask for both sides because you're pointing at a done deal, not inventing structure.

## Team / employee retention (often a top-ranked goal)

The three buckets above are about *founders*. If the seller ranks "do right by my team" highly, make the **employee retention pool** an explicit, named line item — not a hope. It's normal in acqui-hires and far harder to add after price is set.

- **Size and name it early** — who is deemed critical, what the pool is, how it vests.
- **Front-load it** (e.g., ~50% year one) so the team has real optionality rather than a 4-year trap.
- Like founder retention, it's typically **paid by the acquirer and carved out around the waterfall**, so an underwater cap table doesn't gate it.
- Distinguish the *critical-retention* group (gets retention packages) from the broader team (severance / transition) and set expectations honestly with both.

## Vesting acceleration (single vs. double trigger)

What happens to *unvested* equity at the acquisition is a separate, negotiable lever — and it interacts with the retention bucket.

- **Single-trigger** — unvested equity vests automatically on the change of control, regardless of whether you stay. Founder-favorable; **uncommon**, because acquirers want to retain you and dislike a key person who's already fully paid.
- **Double-trigger** — vesting accelerates only if *two* events occur: the acquisition **and** termination without cause (or resignation for good reason). The market standard; acquirers and investors prefer it.
- Founders/execs negotiate single-trigger (or partial acceleration) as a senior ask. For a *joining* founder, model acceleration **together with** the retention package — they're two halves of "what I actually walk with," and an acquirer trading less on one will want more on the other.
- **Tie the triggers together:** if part of your consideration is an employment-tied earn-out, make sure the **same termination-without-cause event accelerates both** your unvested equity *and* the earn-out (see `./references/deal-mechanics.md`) — otherwise a month-13 firing can wipe out both at once.

## Management carve-out plans (the formal instrument)

The "carve-out" is not just a concept — it's usually a **board-adopted plan** that sets aside a pool (often a % of acquisition proceeds) for key people, paid ahead of (or alongside) the preference stack.

- When proceeds are below the preference stack, the plan can take its pool **off the top** before preferred is satisfied — which is exactly what gets common-holding founders/employees real money in an underwater deal.
- **Board fiduciary risk:** because insiders benefit, a poorly structured plan invites breach-of-fiduciary-duty / corporate-waste claims, and the board's conduct may be judged under the stricter **entire-fairness** standard rather than the business-judgment rule. Structure it deliberately (independent approval, defensible allocation between common and preferred) — this is counsel's job, but flag it early.
- Get the plan **adopted before** the sale dynamics make it look self-dealing.

## Salary bands vs. deal consideration

Many acquirers (especially band/fairness-driven cultures) hold internal comp bands hard. The load-bearing move: **keep salary in-band; put the premium in the M&A / earn-out bucket.** M&A consideration lives in a separate accounting from comp bands, so it doesn't trigger internal-equity objections. Confirm this separation with the acquirer's deal owner early — it's often the difference between a yes and a no.

## Tax — size the ask backward

The take-home depends heavily on *which bucket* the money lands in:

- **Salary / bonus / employment-tied earn-out** = ordinary income. In a high-tax state (NY/CA) ~45–52% combined marginal. **Gross ≈ ~2× the after-tax target.**
- **Acquisition consideration for equity** = capital gains, and possibly **QSBS** (federal exclusion up to the greater of $10M or 10× basis, if the stock qualifies — C-corp, original issuance, >5yr hold, etc.). Far more efficient — but for an **underwater** founder behind the stack, there's little equity value to apply it to, so it's usually moot for them personally.
- **§280G golden parachute (landmine):** change-in-control payments to a key person (cash + accelerated vesting + retention) that exceed **3× their average W-2 comp over the prior 5 years** trigger a **20% excise tax on the recipient and lost deduction for the company** on the excess. A big, front-loaded package can trip this. Mitigations exist but must be *planned* — private companies can use a cleansing **shareholder vote**, or a **cutback** to stay under the safe harbor. Raise it with tax counsel early; it's a common, avoidable surprise.
- **Always size from the after-tax number**, gross up, and check living costs over the vesting window — "$X in the bank after N years" must cover taxes *and* living, not just savings.

⚠️ Carve-out mechanics, §280G, and any capital-gains treatment are **legal/tax-advisor questions**. This reference sizes the strategy and names the shape; counsel + a tax advisor nail the structure. Flag this to the founder *before* they name numbers — the whole take-home rests on it.

## Quick checklist

- [ ] Clearing price vs. pref stack — above or underwater? (Confirm, don't assume.)
- [ ] Where does the founder sit? What's actually theirs?
- [ ] Which buckets apply (investor / non-joining carve-out / joining retention / team pool)?
- [ ] Named precedent in the same situation to anchor on?
- [ ] Salary in-band, premium in M&A bucket — separation confirmed with deal owner?
- [ ] After-tax target → grossed up → covers tax + living + savings?
- [ ] Counsel + tax engaged on carve-out + cap-gains before numbers are named?
