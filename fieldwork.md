# Fieldwork — RackFlow

## 1. Visit Log (20+ Minutes)
- **Place:** [Hope Pharmacy, Batamaloo Srinagar]
- **Date:** [21 November 2026]
- **Photos:**
  - ![Image1 — 9:30PM](./photos/Image1.jpg)
  - ![Image2 — 10:30PM](./photos/Image2.jpg)

## 2. Conversation
- **Name:** [Sajad]
- **Role:** [Counter Helper]
- **3 Things They Said:**
  1. They actually arrange medicines in alphabetical order, but certain letters take up so many columns that locating one specific medicine inside a single letter's section is still tedious.
  2. Customer lists and prescriptions come in random order, so staff end up walking back and forth across the shop multiple times going from one alphabet section to another—and strict alphabetical placement means even high-use medicines aren't kept nearby the counter.
  3. Staff who work there day in and day out for years eventually build muscle memory for it, but newcomers—or a relative like a brother temporarily covering a helper's shift—struggle to find medicines fast enough.
- **1 Thing That Surprised Me:**
  - Before talking to him, I assumed the slowness came from having no organizing scheme at all. What surprised me is that the shop *does* follow strict alphabetical order, and that scheme itself creates two bottlenecks: bloated letter blocks spanning too many columns, and high-frequency medicines getting stuck far away from the counter. This shifted my focus—instead of trying to force a new sorting scheme on the shop, RackFlow should map onto their existing racks down to exact `(Row, Col)` coordinates and automatically reorder random prescriptions into one continuous walk so even a temporary fill-in can pick a full list quickly.

## 3. How `data/data.csv` Was Collected
**Data Link** ![data.csv](./data/data.csv)
- **Rows collected:** 52 entries (`RF01`–`RF52`, covering 2 medicines per letter from A–Z)
- **Method:** Collected manually during the 20:47–21:30 window while standing near the front counter. For each medicine, I logged its brand name, salt composition, physical rack coordinate (`unit_id`, `row`, `col`), and retail MRP off the pack where clearly visible, timing `find_time_sec` with a phone stopwatch from the moment the item was called out until it reached the counter.

## 4. Dataset Snapshot & Field Notes
- **Schema (`10 columns`):** `id, brand_name, salt_compound, unit_id, row, col, mrp_inr, find_time_sec, observed_at, last_verified`
- **Physical Storage Split (mapped to `data/layout.json`):**
  - **`W1` (41 items):** 35 tablets/capsules placed alphabetically across Rows 1–3, plus 6 syrups/suspensions separated onto the wider bottom shelf (Row 4).
  - **`D1` (8 items):** Ointments, gels, face wash, and eye drops stored in counter drawers.
  - **`F1` (3 items):** Cold-chain insulins (`Glaritus`, `Lantus Solostar`, `Wosulin-R`) stored in the corner fridge.
- **Notable Friction & Messiness Captured:**
  - **17 slow lookups (`> 30.0s`):** Concentrated in deep or crowded letter blocks (`A`, `M`, `P`, `R`, `T`, `Z`), peaking at `35.5s` (`RF31`).
  - **2 unread prices:** `mrp_inr` left blank on `RF32` and `RF47` where strips could not be read cleanly, ensuring RackFlow handles partial subtotals gracefully.
  - **Same-salt scatter:** Identical or overlapping active compounds sit across distant alphabetical columns (e.g., `Ampoxin-CV` at `W1 R1·C1` vs. `Moxikind-CV` at `W1 R2·C4`; `Telmikind 80` vs. `Yogatel 40`), confirming why compound search is essential alongside brand lookup.