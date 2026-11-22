# RackFlow — Offline Pharmacy Shelf Finder & Pick-Route Helper

**RackFlow** is a lightweight, offline web app for neighborhood pharmacies. It runs on the shop's counter computer and lets staff look up medicine shelf locations on their phones over local Wi-Fi—with zero internet needed.

---

## Demo & Fieldwork

* **Demo Walkthrough:** [Watch the Video (`./demo/rackflow-demo.mp4`)](./demo/RackFlow.mov)
* **Shop Research & Photos:** [Read `fieldwork.md`](./fieldwork.md) (shelf notes, lookup timings, and rack photos in [`./photos/`](./photos/))
* **Default Moderator PIN:** `1234` (editable in `data/org_config.json`)

---

## The Problem It Solves

Alphabetical shelving (`A–Z`) rarely survives in a real pharmacy:

* **Shelves are uneven and specialized:** Insulin has to stay in the fridge, tall syrups go on deep bottom shelves, and fast-selling strips get pulled into counter drawers.
* **Only senior staff know where things are:** New helpers waste time searching deep shelves during busy hours.
* **Prescriptions cause back-and-forth walking:** Picking 4–5 items in the order written on a slip sends staff zig-zagging across the shop.
* **No cloud headaches:** Local shops need something fast, free of subscriptions, and usable even when the internet is down.

**Shop Mapped:** Built from fieldwork at **[FILL: Shop Name, Location — matching `fieldwork.md`]**, covering **52 medicines** across three units: Counter Drawers (`D1`), Left Wall Rack (`W1`, with uneven shelf widths), and Corner Fridge (`F1`).

---

## Key Features

### 1. Fast, Safe Medicine Search
* **Search by brand or active salt:** Type a brand name (`crocin`) or a generic salt (`amoxycillin`) to find every matching brand in the shop.
* **Safe typo protection:** Catches minor typos (`crocn` → `Crocin Advance`) and marks them with an amber **`APPROX`** badge, while deliberately refusing to guess between look-alike/sound-alike drug names (like *Cefixime* vs. *Cefuroxime*).

### 2. Visual Shelf Map & Neighbor Clues
* **Matches real uneven racks:** Draws each shelf with its exact number of columns (e.g., rows of 5, 7, 7, and 3) and highlights the target box.
* **Easy eye-landmarks:** Shows what medicines sit **Left**, **Right**, and in the **Same Bin** as your target, so helpers can spot a strip immediately even without shelf stickers.

### 3. Single-Pass Pick Slip
* **No more zig-zagging:** Add multiple prescription items to the Pick Slip and RackFlow automatically sorts them into one smooth walk through the shop (`D1 → W1 → F1`), column by column.
* **Safe price estimates:** Calculates an estimated total and clearly flags items with a missing MRP instead of showing `₹0` or breaking the total.

### 4. PIN-Protected Moderator Tools
Unlock with PIN **`1234`** to manage the shop from any phone or computer:

* **Bottleneck Radar:** Highlights slow-to-find medicines (`>15s`), active salts scattered across too many racks, and items floor staff flagged as **"Not Here?"**—with a 1-click button to pull slow deep-shelf items closer to the counter.
* **Shelf Edits:** Move individual medicines, swap two bins cleanly, shift columns along a row, or quick-add new arrivals.
* **Shop Layout Editor:** Reorder racks with Up/Down buttons if the shop layout changes (for example, moving the fridge closer than the wall rack) and adjust shelf sizes. Built-in safety checks stop you from deleting or shrinking a shelf that still holds medicines.
* **New Stock Inbox (CSV Import):** Paste or load a local distributor `.csv` file to drop new arrivals into an *Unassigned* inbox, then assign them to shelves whenever staff have time.
* **Activity Log & 1-Click Undo:** Tracks who made each change and automatically backs up `data/data.csv` before every edit so mistakes can be undone in one click.

---

## How It Runs Offline

RackFlow runs as one local server on port `3000`—no external databases, no cloud services, and no internet connection required after setup. All shop data lives in plain, readable files inside `data/`:

* `data/data.csv` — Your medicine list and shelf locations (bad or incomplete rows are flagged safely without crashing the app).
* `data/layout.json` — Your rack names, walk order, and shelf sizes.
* `data/org_config.json` — Shop name, staff names, and Moderator PIN.
* `data/backups/` & `data/audit_log.jsonl` — Automatic local backups and change history (ignored by Git).

---

## Setup & Running Locally

### What You Need
* **Node.js 20+** and **npm** (internet is only needed once to install packages).

### 1. Install Packages
```bash
npm install
npm --prefix server install
npm --prefix client install
```

### 2. Build & Start the Offline Server
```bash
npm run build
npm start
```

The terminal will print two addresses:
```text
RackFlow LAN Server ready (offline-first)
  Local:     http://localhost:3000
  Shop WiFi: [http://192.168.](http://192.168.)x.x:3000
```

* Open `http://localhost:3000` on the counter computer.
* Open the **`Shop WiFi`** address on any staff phone or tablet connected to the same Wi-Fi router.

### Running in Development Mode (Optional)
For live auto-reload while editing code (runs the UI on port `4200` and API on port `3001`):
```bash
npm run dev
```

---

## Sample Output

Captured directly from the local server running on port `3000`:

**Typo Search (`GET /api/search?q=crocn`)**
```json
{"query":"crocn","count":1,"elapsedMs":3.13,"results":[{"item":{"item_id":"RF05","brand_name":"Crocin Advance 500mg Tablet","salt_compound":"Paracetamol (500mg)","strength_form":"","category":"","tags":[],"unit_id":"W1","row":1,"col":2,"mrp_inr":19.53,"find_time_sec":15.8,"observed_at":"20:49","last_verified":"2026-11-21","status":"OK","notes":""},"score":0.8333333333333334,"tier":3,"isApproximate":true,"alsoStoredAt":[],"cue":{"code":"W1 · R1 · C2","unit_name":"Left Wall Rack","anchor_rule":"Row 1 = Top Shelf | Col 1 = Closest to Counter","band":"Top · Front End","siblings":["Budamate 100 Transcaps"],"left":{"col":1,"brands":["Atorva Gold 10 Capsule","Ampoxin-CV 500mg/125mg Tablet"]},"right":{"col":3,"brands":["Duloren 20 Tablet"]}},"isSlowFind":true,"isStale":false}]}
```

**Single-Pass Pick Route (`POST /api/route`)**
```json
{
    "groups": [
        {
            "unit_id": "D1",
            "unit_name": "Counter Drawers",
            "anchor_rule": "Row 1 = Top Drawer | Col 1 = Leftmost",
            "stops": [
                {
                    "item": {
                        "item_id": "RF04",
                        "brand_name": "Benxop Face Wash",
                        "salt_compound": "Benzoyl Peroxide (4% w/w)",
                        "strength_form": "",
                        "category": "",
                        "tags": [],
                        "unit_id": "D1",
                        "row": 1,
                        "col": 1,
                        "mrp_inr": 235,
                        "find_time_sec": 7.2,
                        "observed_at": "20:48",
                        "last_verified": "2026-11-21",
                        "status": "OK",
                        "notes": ""
                    },
                    "qty": 1,
                    "code": "D1 \u00b7 R1 \u00b7 C1",
                    "lineTotal": 235,
                    "cue": {
                        "code": "D1 \u00b7 R1 \u00b7 C1",
                        "unit_name": "Counter Drawers",
                        "anchor_rule": "Row 1 = Top Drawer | Col 1 = Leftmost",
                        "band": "Top \u00b7 Front End",
                        "siblings": [],
                        "left": null,
                        "right": {
                            "col": 2,
                            "brands": [
                                "Fusiwal Cream"
                            ]
                        }
                    },
                    "isSlowFind": false
                }
            ]
        },
        {
            "unit_id": "W1",
            "unit_name": "Left Wall Rack",
            "anchor_rule": "Row 1 = Top Shelf | Col 1 = Closest to Counter",
            "stops": [
                {
                    "item": {
                        "item_id": "RF51",
                        "brand_name": "Zerodol-SP Tablet",
                        "salt_compound": "Aceclofenac (100mg) + Paracetamol (325mg) + Serratiopeptidase (15mg)",
                        "strength_form": "",
                        "category": "",
                        "tags": [],
                        "unit_id": "W1",
                        "row": 3,
                        "col": 3,
                        "mrp_inr": 150.85,
                        "find_time_sec": 20.4,
                        "observed_at": "21:14",
                        "last_verified": "2026-11-22",
                        "status": "OK",
                        "notes": ""
                    },
                    "qty": 1,
                    "code": "W1 \u00b7 R3 \u00b7 C3",
                    "lineTotal": 150.85,
                    "cue": {
                        "code": "W1 \u00b7 R3 \u00b7 C3",
                        "unit_name": "Left Wall Rack",
                        "anchor_rule": "Row 1 = Top Shelf | Col 1 = Closest to Counter",
                        "band": "Lower-Middle \u00b7 Front End",
                        "siblings": [
                            "Zifi 200 Tablet"
                        ],
                        "left": {
                            "col": 2,
                            "brands": [
                                "Telmikind 80 Tablet"
                            ]
                        },
                        "right": {
                            "col": 4,
                            "brands": [
                                "Qutan SR 300 Tablet",
                                "Qdmrd 200 Tablet"
                            ]
                        }
                    },
                    "isSlowFind": true
                },
                {
                    "item": {
                        "item_id": "RF32",
                        "brand_name": "Pioglit 30 Tablet",
                        "salt_compound": "Pioglitazone (30mg)",
                        "strength_form": "",
                        "category": "",
                        "tags": [],
                        "unit_id": "W1",
                        "row": 2,
                        "col": 4,
                        "mrp_inr": null,
                        "find_time_sec": 18.6,
                        "observed_at": "21:04",
                        "last_verified": "2026-11-22",
                        "status": "OK",
                        "notes": ""
                    },
                    "qty": 1,
                    "code": "W1 \u00b7 R2 \u00b7 C4",
                    "lineTotal": null,
                    "cue": {
                        "code": "W1 \u00b7 R2 \u00b7 C4",
                        "unit_name": "Left Wall Rack",
                        "anchor_rule": "Row 1 = Top Shelf | Col 1 = Closest to Counter",
                        "band": "Upper-Middle \u00b7 Middle",
                        "siblings": [
                            "Pregabid ME 75 Capsule"
                        ],
                        "left": {
                            "col": 3,
                            "brands": [
                                "Moxikind-CV 625 Tablet",
                                "Metafort 1000 Tablet SR"
                            ]
                        },
                        "right": {
                            "col": 5,
                            "brands": [
                                "Hifenac-MR Tablet",
                                "Inac 50 Tablet"
                            ]
                        }
                    },
                    "isSlowFind": true
                }
            ]
        },
        {
            "unit_id": "F1",
            "unit_name": "Corner Fridge",
            "anchor_rule": "Row 1 = Top Shelf | Single Column",
            "stops": [
                {
                    "item": {
                        "item_id": "RF14",
                        "brand_name": "Glaritus 100IU/ml Injection",
                        "salt_compound": "Insulin Glargine (100IU)",
                        "strength_form": "",
                        "category": "",
                        "tags": [],
                        "unit_id": "F1",
                        "row": 1,
                        "col": 1,
                        "mrp_inr": 585,
                        "find_time_sec": 5.9,
                        "observed_at": "20:54",
                        "last_verified": "2026-11-21",
                        "status": "OK",
                        "notes": ""
                    },
                    "qty": 1,
                    "code": "F1 \u00b7 R1 \u00b7 C1",
                    "lineTotal": 585,
                    "cue": {
                        "code": "F1 \u00b7 R1 \u00b7 C1",
                        "unit_name": "Corner Fridge",
                        "anchor_rule": "Row 1 = Top Shelf | Single Column",
                        "band": "Top",
                        "siblings": [],
                        "left": null,
                        "right": null
                    },
                    "isSlowFind": false
                }
            ]
        }
    ],
    "unmapped": [],
    "unknownIds": [],
    "subtotalInr": 970.85,
    "missingMrpCount": 1,
    "lineCount": 4
}
```

---

## Running Tests

Verify the backend logic, CSV safety checks, search rules, and API routes:

```bash
npm --prefix server run typecheck
npm test
npm run build
```

---

## Important Limits & Safety Notes

* **Shelf-finding aid only:** Never use RackFlow for medical advice or drug substitution. Always check the physical strip's name, strength, salt, and expiry date before dispensing.
* **Not a billing or stock-count system:** Prices shown are reference MRPs from `data.csv`, not final GST bills or live strip counts.
* **Strict typo safety:** Heavy misspellings return *no results* on purpose so the app never suggests the wrong medicine.
* **Undo scope:** **1-Click Undo** restores previous versions of `data/data.csv`. Structural rack edits save directly to `data/layout.json` after checking that no medicines are displaced.
* **Local Wi-Fi note:** To open the app from phones, the router must allow devices on the same Wi-Fi to talk to each other (Client/AP Isolation off) and the computer's firewall must allow port `3000`.
* **Testing notes:** [FILL: Add 1–2 short observations from testing RackFlow yourself on laptop and phone.]
