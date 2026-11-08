# BrotIA presenter script

Press → when you finish each block. Slides hold on their last frame, so you never have to rush.
Speak at a calm pace: about 2.5 words per second.

## 1 · Logo (about 7 s)
> This is **BrotIA**: *brote*, a new shoot, plus **IA**. We watch what grows, so lenders know which loans are at risk.

**→**

## 2 · Problem (about 9 s)
> Orchards are financed for years, but climate risk changes every week.
> Today, lenders find out at the missed payment.
> Disasters cost crops and livestock **123 billion dollars a year**, about **5 % of global agricultural GDP**.
> One frost night, one dry year, one fire is enough.

**→**

## 3 · Solution (about 12 s)
> BrotIA watches every financed field from space.
> From satellite we read vigour, canopy moisture, abandonment and fire.
> From weather we read frost, heat, harvest rain and water supply.
> It all becomes **one risk score per crop, growth stage and zone**. When the risk turns high, BrotIA flags that the loan needs cover.

**→**

## 4a · Portfolio view
> Here is a portfolio: **nine orchards** in southern Chile, **1.2 million dollars** outstanding, **two at high risk**.

**→**

## 4b · The orchard
> Let's open one: a **22-hectare cherry block** near Los Ángeles. The outline comes straight from the national fruit cadastre.

**→**

## 5 · Season (about 10 s)
> Every five days we get a new satellite image of the block.
> Since **mid-September**, its canopy moisture has fallen below its own normal. Today it is **2.7 standard deviations** under.
> Risk: **83.5, high**, and that is **six months before** the next payment is due.

**→**

## 6 · Loan (about 9 s)
> Here is the loan. Last March's installment was paid on schedule.
> The next one, **105,000 dollars due March 31st**, is now at high risk, with 210,000 more behind it.
> The bank sees it **six months early**. It can review repayment capacity and send a cover request to **Suyana** in one click.

**→**

## 7 · Close (about 3 s)
> BrotIA: climate risk for agricultural lending. Let's go inside.

**→** (enter the platform)

---

## In the platform (optional, about 60 s)
- **Home:**
  > This is the lender's home: the payments coming due, coloured by the risk of the farm paying them, and the risk of each portfolio.
- **Portfolio report** (open *CLSF1*):
  > Each portfolio is a report. For every farm: outstanding balance, share of the book, and its risk-weighted contribution.
- **Farm** (open *Ovalle table grapes*):
  > Each farm opens with a verdict in plain language: these vines look abandoned, bare soil all season while the neighbours stayed green. Then what to do, and why. Every number traces back to its source.
- **Insurance** (click *Request* in the report table):
  > One click drafts a cover request to Suyana, prefilled with the farm, the loan and the risk.
- **Close:**
  > For Suyana, it's one deal per loan book instead of selling farm by farm. Our next step is a **one-season pilot with one lender**.

---

## If the judges ask
| Question | Answer |
|---|---|
| Are these real loans? | The orchards, satellite and weather data are real. Loan amounts and schedules are illustrative. |
| Only Chile? | Chile uses enhanced national data. Everywhere else runs on the same global sources: Sentinel-2 imagery and ERA5 weather. |
| Is the AI-sharpened imagery used in the score? | No. Scores use the native 10 m pixels only. The AI-enhanced images are for display. |
| The Los Ángeles map photo looks green, but you say stress? | The basemap photo is older. Our score uses this season's Sentinel-2 images, which show canopy moisture collapsing since September. A field visit confirms it. |
| How do you set the thresholds? | They are expert defaults per crop and growth stage. Lenders can edit them per zone or farm, with an audit trail, and the farming agent backtests them against past seasons. |
