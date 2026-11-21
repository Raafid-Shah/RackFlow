# Research — RackFlow

## The Problem:
1. A large medicine order of 10-15 different medicines takes 10-15 minutes to complete.
2. No coordinate system that could help navigate the racks.
3. Helpers memorize only a few racks, causing repeated backtracking whenever prescriptions span the shop or stock shifts.
4. Manually checking MRPs and totaling the gathered batch creates a second bottleneck at the counter.
5. Due to budget constraints for scanners or reliable internet, staff need an offline phone tool to search by brand/compound and pick in one sorted walk.

## Two Existing Solutions & Why They Don't Fit:
1. **Desktop Pharmacy ERPs (e.g., Marg ERP):** Include a rack field for billing, but keep lookup tied to the counter PC and charge per-user fees (Marg Nano starts at ₹5,550 + 18% GST, ₹3,000/extra user, capped at 2 users) rather than helping floor staff on phones.
2. **Electronic Shelf Labels & WMS Scanners (e.g., Walmart / quick-commerce dark stores):** Flashing shelf LEDs and handheld terminals solve visual lookup at scale, but require costly hardware and standardized shelving a small local chemist cannot afford.

## Two Sources Read:
1. **Walmart Corporate — "Can't Find It? Walmart Can Light the Way" (Oct 2026)** — https://corporate.walmart.com/news/2026/10/cant-find-it-walmart-can-light-the-way
   - Explains Walmart's LED shelf-label system (*Stock to Light*, *Pick to Light*, *Shop to Light*) for pinpointing near-identical products.
   - Notes that visual highlighting cuts out shelf-by-shelf scanning and double-checking across similar packages—the exact issue with medicine strips.
   - Inspired RackFlow's zero-hardware software equivalent: lighting up the target rack cell directly on a staff phone.

2. **Marg ERP — "Best Drug Inventory Management Software System in India"** — https://margcompusoft.com/drug-inventory-management-software.html
   - Confirms rack-wise stock tracking is a recognized pain point in Indian pharmacies, built into Marg primarily to identify rack locations during billing.
   - Shows the cost/access barrier for small teams: Marg Nano starts at ₹5,550 + 18% GST with a 2-user cap and ₹3,000 per additional user.
   - Guided RackFlow to stay free, run offline over local shop Wi-Fi, and focus strictly on fast mobile compound lookup and single-swoop batch picking.