# Paid Ads Plan — What a Jerk

*Local QSR paid-ads playbook. Small budget, hyperlocal, creative-heavy.*

---

## Budget & Channels

| Channel | Monthly Budget | When to start |
|---------|---------------|---------------|
| **Meta (IG + FB)** | €300 | Week -1, ramps opening week |
| **Google Search + Maps** | €150 | Week -1 |
| **TikTok Ads** | €50 (test only) | Month 2+ |
| **Wolt / Uber Eats boosts** | €100 | Opening week |
| **Total** | **€600/month** | — |

*Scale up after month 1 only if CPA justifies it. For a QSR, target €2–4 cost per walk-in or €3–5 cost per Wolt order.*

---

## Why This Mix

- **Meta (IG + FB)** — Where your demographic scrolls. Instagram carries this channel. FB as bonus audience.
- **Google Search + Maps** — Captures "jerk chicken berlin" / "jamaican near me" — highest-intent traffic.
- **TikTok** — Skip until you have 5+ good short-form reels organically. Ads without proven creative is a money pit.
- **Wolt/UE boosts** — Native delivery app promotion. Cheap, highly targeted to delivery-intent users.

---

## Meta Campaign Plan

### Account setup (do this Week -3)

- [ ] Meta Business Manager created
- [ ] FB Page for What a Jerk (linked to IG)
- [ ] Ad account attached to Business Manager
- [ ] Billing card added (expect to prepay €50 to start)
- [ ] Meta Pixel installed on `whatajerk.berlin` site
- [ ] Conversion API (CAPI) set up (bypasses iOS tracking limits — big deal for mobile audience)
- [ ] Domain verified
- [ ] 8 custom events defined (see `analytics/` for full list)

### Campaign Structure

```
META_WhatAJerk_Launch
├── Campaign 1: Reach — Opening Awareness
│   ├── Ad Set 1: 3km radius Kotti Damm, 25–45, food interest
│   │   ├── Ad A: Origin story reel
│   │   ├── Ad B: Jerk wrap hero video
│   │   └── Ad C: Carousel menu
│   └── Ad Set 2: Berlin-wide, 25–45, Caribbean interest (warm)
├── Campaign 2: Traffic — Order Now
│   ├── Ad Set 1: 3km radius, meal-time dayparting
│   │   ├── Ad A: Lunch-focused carousel
│   │   └── Ad B: Dinner-focused reel
│   └── Ad Set 2: Late night (Fri/Sat 20:00–01:00), 3km radius
└── Campaign 3: Retargeting
    ├── Ad Set 1: Website visitors (last 30 days)
    └── Ad Set 2: Instagram engagers (last 60 days)
```

### Targeting

**Campaign 1 — Awareness (broad):**
- Location: 3 km radius around Kottbusser Damm 96
- Age: 25–45
- Gender: All
- Languages: English, German
- Interests: Food & drink, Street food, Caribbean cuisine, Jerk chicken, Foodie, Neukölln, Kreuzberg, Restaurants, Travel (Caribbean, Jamaica)
- Behaviors: Engaged shoppers, Foodies, Late-night lifestyle
- Exclude: Current Ssam customers (if pixel-tagged), employees

**Campaign 2 — Traffic (more specific):**
- Location: 2 km radius (tighter — actual walk-in zone)
- Age: 25–40
- Placement: Instagram Feed + Stories + Reels only (skip FB feed)
- Dayparting:
  - Lunch ad set: 10:00–14:00
  - Dinner ad set: 17:00–21:00
  - Late-night ad set: 22:00–01:00 Fri/Sat only

**Campaign 3 — Retargeting:**
- Custom Audience 1: Website visitors, last 30 days (PixelFire: PageView)
- Custom Audience 2: Instagram Profile visitors, last 60 days
- Custom Audience 3: Video viewers (watched 50%+ of any reel), last 60 days

### Bid & Budget

| Campaign | Daily Budget | Bid Strategy |
|----------|-------------|--------------|
| Awareness | €7 | Lowest cost |
| Traffic (3 ad sets combined) | €8 | Lowest cost (conversions: Landing page views → switch to "Lead" / "Order-now click" once you have 50+ events) |
| Retargeting | €3 | Lowest cost |

**Total daily:** ~€18 → ~€540/month. Scale to €300/month by pausing Awareness once Traffic is optimized (week 3+).

---

## Meta Ad Creative Briefs

### Ad A — Origin story (Awareness)

**Format:** Vertical video, 30 sec, captions baked in.

**Script:**
```
[0-3s] HOOK: Ethan on camera, quick cut.
       "I'm Chinese. I'm Berliner. I'm not Jamaican."

[3-10s] STORY: Montage — Vancouver street, Toronto storefront, jerk being grilled.
        VOICEOVER: "But I fell in love with jerk chicken in Vancouver and Toronto."

[10-18s] BUILD: Quick cuts of Berlin — Kotti Damm sign, What a Jerk storefront.
         VOICEOVER: "So I brought it home. Kottbusser Damm 96."

[18-25s] PRODUCT: Jerk wrap being made, plated.
         TEXT OVERLAY: "Jerk chicken wraps €8.50 · Open daily from 12"

[25-30s] CTA: Storefront shot, hours on screen.
         TEXT: "Follow @whatajerkberlin"
         END CARD: Logo + whatajerk.berlin
```

**Copy:**
```
Headline: From Vancouver to Kotti Damm.
Primary text: Berlin's first proper Jamaican quick-service spot is now open on Kottbusser Damm 96. Jerk wraps €8.50, curry goat, oxtail stew, real scotch-bonnet heat. Ya mon.
CTA button: Get directions
```

### Ad B — Jerk wrap hero (Awareness)

**Format:** Vertical video, 15 sec, tight close-ups, reggae bed.

**Script:**
```
[0-2s] HOOK: Raw jerk marinade being brushed on chicken. Smoke.
[2-6s] Chicken on grill, flames, quick flip.
[6-10s] Wrap being assembled — slaw, sauce, chicken, fold.
[10-13s] Bite shot — first bite of wrap, hand holding it.
[13-15s] END CARD: Logo + "€8.50 · Kotti Damm 96" + CTA.
```

**Copy:**
```
Headline: €8.50 jerk wrap. Berlin's new obsession.
Primary text: Real scotch-bonnet heat. Fresh slaw. Smoky grilled chicken. Open daily till 23:00, Fri/Sat till 01:00. Kottbusser Damm 96.
CTA: Order Now → (links to Wolt or IG Profile)
```

### Ad C — Menu carousel (Awareness)

**Format:** Carousel, 5 slides, each slide 1:1 square.

**Slides:**
1. Hero wrap photo · "The Jerk Chicken Wrap · €8.50"
2. Oxtail close-up · "Ochsenschwanz-Stew · €15 · Slow-braised 4 hours"
3. Patty halved · "Beef Patty · €3.50 · Flaky. Spicy. Portable."
4. Curry goat · "Curry Goat · €15 · Not for the faint"
5. Full spread · "All this. Kottbusser Damm 96. Open 12–23."

**Copy:**
```
Headline: The full menu, Berlin.
Primary text: Jamaican quick-service on Kotti Damm. Wraps from €8.50, dishes €12–15, patties €3.50. Open daily. Delivery on Wolt & Uber Eats.
CTA: View Menu → /menu
```

### Ad D — Lunch-specific (Traffic, dayparted 10:00–14:00)

**Format:** Vertical reel, 10 sec.

**Script:**
```
[0-2s] Office worker looking at döner, unimpressed.
[2-5s] Same person seeing a What a Jerk wrap — eyes widen.
[5-8s] Wrap being plated, handed to customer.
[8-10s] END CARD: "Lunch just got good. Kotti Damm 96."
```

**Copy:**
```
Headline: Lunch ≠ döner.
Primary text: Jerk chicken wrap, €8.50, out the door in 5 min. Kottbusser Damm 96. Open now.
CTA: Get directions
```

### Ad E — Late night (Traffic, dayparted 22:00–01:00 Fri/Sat)

**Format:** Vertical reel, 10 sec, darker mood, bar vibes.

**Script:**
```
[0-2s] Late-night Neukölln street shot — neon, bar signs.
[2-5s] What a Jerk storefront lit, people going in.
[5-8s] Wrap being handed across counter, 23:xx on clock in frame.
[8-10s] END CARD: "Jerk till 1am. Kotti Damm 96."
```

**Copy:**
```
Headline: Still open. Still fire. 🔥
Primary text: Late-night Jamaican on Kotti Damm. Wraps, patties, and a Red Stripe till 01:00 Fri + Sat.
CTA: Get directions
```

---

## Google Ads Plan

### Campaign Structure

```
GOOG_WhatAJerk
├── Campaign 1: Search — Jamaican Food Berlin
│   ├── Ad Group 1: Jamaican / Jerk keywords
│   ├── Ad Group 2: Caribbean food
│   └── Ad Group 3: Delivery-intent
├── Campaign 2: Performance Max (Smart)
│   └── Asset Group: All creative
└── Campaign 3: Local Maps (free — see below)
```

### Keywords (Campaign 1)

**Ad Group 1 — Jamaican/Jerk:**
- Exact match: [jamaican restaurant berlin], [jerk chicken berlin], [jamaikanisches restaurant berlin]
- Phrase match: "jamaican food berlin", "jerk chicken neukölln", "curry goat berlin"
- Broad match modifiers: jamaican kreuzberg, jamaican kottbusser, caribbean food berlin

**Ad Group 2 — Caribbean food:**
- Exact: [caribbean restaurant berlin], [karibisches restaurant berlin]
- Phrase: "caribbean food kreuzberg", "caribbean takeaway berlin"

**Ad Group 3 — Delivery:**
- Phrase: "jamaican delivery berlin", "wolt jamaican", "jerk chicken delivery"

### Negative Keywords (important)

- -recipe
- -"how to make"
- -wholesale
- -bob marley
- -reggae music (unless you expand to music events)
- -jobs
- -kaufen (shopping intent)

### Ad Copy — Google Responsive Search Ads

**Headlines (15, platform rotates):**
1. Jamaican Food on Kotti Damm
2. Real Jerk. Real Heat.
3. Jerk Chicken Wraps €8.50
4. Open Daily Till 23:00
5. Fri + Sat Till 01:00
6. Curry Goat · Oxtail · Patties
7. Kottbusser Damm 96, Berlin
8. Order on Wolt Now
9. Vegan Jackfruit Stew Available
10. From the Team Behind Ssam
11. Berlin's First Jamaican QSR
12. Jamaikanisches Essen Neukölln
13. Jerk Chicken Delivery Berlin
14. Taste Kingston on Kotti Damm
15. Patties Hot Out the Oven

**Descriptions (4):**
1. Berlin's first proper Jamaican quick-service spot. Jerk wraps €8.50, curry goat, oxtail, patties. Real scotch-bonnet heat.
2. Open daily from 12:00, Fri + Sat till 01:00. Walk in, takeaway, or order on Wolt + Uber Eats.
3. From the restaurateur behind Ssam. Jerk, patties, and fire on Kottbusser Damm 96.
4. Pick your heat: mild, medium, jerk, or full fire. Bilingual menu, vegan options available.

**Final URL:** `https://whatajerk.berlin/menu`

### Campaign 2 — Performance Max

Submit to Google Ads:
- All 15 headlines
- All 4 descriptions
- 5 hero images (square + portrait crops)
- 2 videos (reuse the origin-story reel + hero wrap reel)
- Logo
- Business name + phone
- Location extensions (from Google Business Profile)

Budget: €3/day. Google optimizes across Search, Maps, YouTube, Gmail, Display.

### Campaign 3 — Local Maps (free via Google Business Profile)

Not a paid ad, but critical:
- Google Business Profile must be fully completed (see `/copy/listings.md`)
- Post "offers" weekly inside GBP (free: "€8.50 lunch deal", "Late-night open till 1am")
- Respond to every review within 24h
- Upload 1 photo/week (Google ranks active profiles higher)

### Google Ads Budget

| Campaign | Daily | Monthly |
|----------|-------|---------|
| Search — keywords | €3 | €90 |
| Performance Max | €2 | €60 |
| Local Maps (free) | €0 | €0 |
| **Total** | **€5** | **€150** |

---

## Wolt / Uber Eats Boost Plan

Both platforms sell in-app promo slots. Use sparingly but strategically opening month.

### Wolt

- **Discovery boost** (€30–50/week) — Appears on "New restaurants Neukölln" carousel for 7 days
- **Item-level promo** — Feature "Jerk Wrap €8.50" on home feed (choose one item, it's cheaper)
- **First-order discount** — Platform-funded 20% off first order (no cost to you, Wolt pays)
- **Skip:** "Delivery fee discount" (unclear ROI)

### Uber Eats

- **Uber Pro boost** — Similar to Wolt Discovery
- **First-order discount** — Use the platform-funded one, not your own discount
- **Featured menu item** — €20–30/week, one featured item at a time

### Rules

- Never run both platforms' boosts at the same time — cannibalizes delivery capacity
- Rotate: Wolt weeks 1+3, Uber Eats weeks 2+4
- Never discount more than 10% yourself — platform discounts are fine because they're funded

---

## Creative Refresh Schedule

Avoid ad fatigue. Launch 3 creatives per ad set, rotate:

| Week | Refresh |
|------|---------|
| Week 1 | Launch 3 creatives per ad set (A/B/C) |
| Week 2 | Pause worst-performing creative, add new D |
| Week 3 | Pause next-worst, add E |
| Week 4 | Only winners remain → major refresh with 3 brand-new hooks |
| Month 2 | Plan seasonal refresh (e.g., summer campaign) |

Signs you need to refresh:
- Frequency > 3 (same user seen your ad 3+ times)
- CTR dropping 30%+ week over week
- CPM rising with no reach change

---

## Week-by-Week Ads Calendar

### Week -1 (May 8–13) — Tease ads, small budget

| Campaign | Budget | Creative |
|----------|--------|----------|
| Meta Awareness | €3/day | Origin story reel + wrap hero only |
| Google Search | €3/day | Search campaigns, Perf Max not yet |

Daily spend: €6 · Weekly: €42

### Week 0 (May 14–20) — Opening week, full scale

| Campaign | Budget | Creative |
|----------|--------|----------|
| Meta Awareness | €7/day | All 3 creatives (A/B/C) |
| Meta Traffic | €8/day | Lunch + Dinner + Late-night (D/E + 1 more) |
| Meta Retargeting | €3/day | "We're open — come by" variant |
| Google Search | €3/day | All ad groups live |
| Google Perf Max | €2/day | Live |
| Wolt Boost | €30/week | Live |

Daily spend: ~€27 · Weekly: ~€220

### Week 1 (May 21–27) — Grand opening weekend push

Same as Week 0, but boost budgets by 50% for Fri/Sat:
- Meta Traffic: €12/day (from €8)
- Google: hold

Daily spend Fri/Sat: €35 · Weekly: ~€240

### Week 2+ (May 28 onward) — Steady state

- Meta Awareness: pause (organic IG carrying awareness)
- Meta Traffic: €8/day (3 ad sets)
- Meta Retargeting: €3/day
- Google Search + Perf Max: €5/day total
- Wolt/UE boosts: €30/week rotating

Daily spend: ~€17 · Monthly: ~€500

---

## Targets & KPIs

| Metric | Week 0 (opening) | Month 1 (avg) |
|--------|-----------------|--------------|
| Meta cost per 1000 impressions (CPM) | < €8 | < €6 |
| Meta click-through rate (CTR) | > 1.5% | > 2% |
| Meta cost per click (CPC) | < €0.50 | < €0.40 |
| Meta cost per landing-page view | < €0.80 | < €0.60 |
| Google search CTR | > 6% | > 8% |
| Google cost per click | < €0.80 | < €0.60 |
| Blended cost per walk-in (attributed) | < €5 | < €3 |
| Blended cost per Wolt/UE order | < €4 | < €3 |

---

## Measurement

- **Meta**: Track "Landing Page View" + "Click to Wolt/UE" custom events via Pixel + CAPI
- **Google**: Track phone clicks, direction clicks, website clicks
- **GA4**: Track outbound clicks to Wolt/UE as custom events
- **In-store attribution** — manual. Staff asks at counter "How did you hear about us?" for opening month, logs in a clipboard or POS note. 1-in-10 sample size.

See `analytics/` for full tracking plan.

---

## What NOT To Do

- **Don't run "like" campaigns.** Vanity metric. Focus on actions.
- **Don't pay for influencer posts.** Gift them food instead — 10x better return.
- **Don't drop Meta as soon as IG feels strong.** Ads compound when organic is strong. They multiply each other.
- **Don't target outside 5km.** A Berliner from Wedding is not going to the Kotti Damm for jerk. Stay hyperlocal.
- **Don't run ads on FB-only placements.** Your audience is on IG.
- **Don't set brand-new Meta audiences to "Conversion" objective on day 1.** Start with "Reach" or "Traffic" — the algorithm needs conversion events to learn. Switch after 50+ conversions logged.
- **Don't run discount ads opening month.** "€2 off first order" attracts deal-seekers who don't come back. Lead with product, not price.

---

## Emergency Brake Rules

Pause any campaign immediately if:
- Frequency > 5 (oversaturating)
- CPC > 2× your target for 3 consecutive days
- Zero actions (clicks/conversions) after €50 spent
- Negative reviews spike during campaign

When pausing, diagnose before restarting. Usually it's a creative problem, not a targeting problem.

---

## Month 2+ Evolution

Once you have:
- 50+ tracked conversions (Wolt clicks, directions, walk-ins)
- 2,000+ IG followers
- 100+ newsletter subscribers
- Clear winner creative

Then:
- Build lookalike audience from website visitors
- Build lookalike from Ssam customer list (if you have emails)
- Test TikTok ads with proven creative
- Test "happy hour" promo (2pm–4pm weekday lull push)
- Partner ads with Neukölln bars for late-night cross-promo
