# Analytics & Measurement Plan — What a Jerk

*What to track, where, and how often to look at it. QSR-specific: walk-ins, deliveries, social, ads.*

---

## The Restaurant Measurement Problem

Unlike SaaS, most of your "conversions" happen offline:
- A walk-in doesn't trigger a pixel
- A Wolt order lives in Wolt's dashboard, not yours
- A Google Maps direction-request doesn't always mean a visit

So the goal isn't perfect attribution. The goal is:
1. **Measure what moves each marketing lever** (IG, ads, press, GBP)
2. **Protect against flying blind** (know when traffic dips)
3. **Make weekly decisions on what to double down on**

---

## What to Track — Master List

### On-site (whatajerk.berlin)

| Event | Property | Source | Why |
|-------|----------|--------|-----|
| `page_view` | page_title, page_location | GA4 auto | Baseline traffic |
| `wolt_click` | source_page | Custom event | Shows Wolt intent |
| `ubereats_click` | source_page | Custom event | Shows UE intent |
| `directions_click` | source_page | Custom event | Walk-in intent |
| `phone_click` | source_page | Custom event | Call intent |
| `instagram_click` | source_page | Custom event | Social intent |
| `menu_viewed` | — | GA4 route match | Evaluation depth |
| `newsletter_submit` | form_location | Custom event | List growth |
| `contact_submit` | form_type (general / catering) | Custom event | Lead capture |

### Off-site (social, platforms)

| Source | Metric | Where to check | Frequency |
|--------|--------|---------------|----------|
| Instagram | Followers, reach, engagement, link clicks, profile visits | IG Insights (Meta Business Suite) | Daily story, weekly review |
| TikTok | Followers, video views, profile visits | TikTok analytics | Weekly |
| Google Business | Views, search queries, direction requests, calls, photo views | GBP Insights | Weekly |
| Meta Ads | CPM, CTR, CPC, landing page views, conversions | Meta Ads Manager | Daily during opening, 2x/week steady |
| Google Ads | Impressions, clicks, CTR, CPC, conversions | Google Ads | Daily during opening, 2x/week steady |
| Wolt merchant | Orders, AOV, ratings, rejected orders, top items | Wolt dashboard | Daily |
| Uber Eats merchant | Same | UE dashboard | Daily |

### In-store (POS + clipboard)

| Metric | Tool | Frequency |
|--------|------|-----------|
| Covers / day | POS report | Daily |
| Revenue / day | POS + delivery apps | Daily |
| Average ticket | POS | Daily |
| Dine-in vs takeaway vs delivery mix | POS + delivery apps | Daily |
| Top-selling items | POS | Daily |
| "How did you hear about us?" | Clipboard (staff asks 1 in 10) | Daily for opening month only |
| Punchcards issued / redeemed | Tally in till | Daily |
| Ssam cross-promo receipts honored | Tally in till | Daily |

---

## Tool Stack

| Purpose | Tool | Cost | Priority |
|---------|------|------|----------|
| Web analytics | **Google Analytics 4** | Free | Day 1 |
| Tag management | **Google Tag Manager** | Free | Day 1 |
| Ad pixel (Meta) | **Meta Pixel + Conversion API** | Free | Week -1 |
| Ad pixel (Google) | **Google Ads tag** | Free | Week -1 |
| Local presence | **Google Business Profile Insights** | Free (built-in) | Week -3 |
| Social | **Meta Business Suite** (IG + FB) | Free | Week -3 |
| Social (TikTok) | **TikTok Business** | Free | Week -2 |
| Delivery | **Wolt Merchant Portal** + **UE Merchant Dashboard** | Free (built-in) | Week -1 |
| POS | Whatever Ssam uses — probably **Lightspeed K** or **Sumup** | Included | Day 1 |
| Consolidated view | **Google Sheets dashboard** | Free | Week 0 |

**Skip for now:** Mixpanel, Amplitude, PostHog, Segment. These are SaaS-product tools and are overkill for a QSR.

---

## Implementation — Step by Step

### Step 1 — Google Analytics 4 (Week -2)

1. Create GA4 property at `analytics.google.com`
2. Install via Google Tag Manager (cleaner than direct gtag)
3. Enable:
   - Enhanced measurement (auto-tracks scroll, outbound clicks, file downloads)
   - IP anonymization (GDPR)
4. Add cookie consent banner — don't fire tags until consent given. Use Cookiebot free tier or Iubenda.
5. Link GA4 to Google Ads + Search Console

### Step 2 — Google Tag Manager setup (Week -2)

Create these tags in GTM:

| Tag | Type | Trigger |
|-----|------|---------|
| GA4 Config | GA4 Config | All pages |
| GA4 — Wolt click | GA4 Event (name: `wolt_click`) | Click on any link with `href` matching `wolt.com` |
| GA4 — UE click | GA4 Event (name: `ubereats_click`) | Click on `ubereats.com` |
| GA4 — Directions click | GA4 Event (name: `directions_click`) | Click on Google Maps embed / directions button |
| GA4 — Phone click | GA4 Event (name: `phone_click`) | Click on `tel:` link |
| GA4 — IG click | GA4 Event (name: `instagram_click`) | Click on `instagram.com` |
| GA4 — Menu viewed | GA4 Event (name: `menu_viewed`) | Page path equals `/menu` |
| GA4 — Newsletter submit | GA4 Event (name: `newsletter_submit`) | Form-ID based trigger |
| Meta Pixel Base | Meta Pixel | All pages |
| Meta Pixel — Lead | Meta Pixel (event: `Lead`) | Newsletter / contact form submit |
| Meta Pixel — InitiateCheckout | Meta Pixel (event: `InitiateCheckout`) | Wolt or UE click |

In GA4 Admin → Events → Mark as Conversion: `wolt_click`, `ubereats_click`, `directions_click`, `phone_click`, `newsletter_submit`, `contact_submit`.

### Step 3 — Meta Pixel + Conversions API (Week -2)

1. Create Meta Pixel in Ads Manager
2. Add via GTM (above)
3. Set up Conversions API via your website hosting provider (Framer / Webflow / Squarespace all have native integrations)
4. Verify domain in Business Settings (iOS 14+ requires this)
5. Configure Aggregated Event Measurement — prioritize these 8 events:
   1. Purchase (used later)
   2. InitiateCheckout (Wolt/UE click)
   3. Lead (newsletter signup)
   4. Contact (contact form)
   5. ViewContent — menu view
   6. PageView
   7. AddToWishlist (not used, placeholder)
   8. Schedule (not used, placeholder)

### Step 4 — Google Ads conversion tracking

- Install Google Ads tag via GTM
- Set up these conversions:
  - `wolt_click` → conversion
  - `ubereats_click` → conversion
  - `directions_click` → conversion
  - `phone_click` → conversion
  - `contact_submit` → conversion
- Link GA4 to Google Ads to import GA4 conversions (recommended)

### Step 5 — UTM parameters

Every ad, email, social link that points to your site must have UTM tags. Format:

```
utm_source=<platform>
utm_medium=<channel>
utm_campaign=<campaign_name>
utm_content=<creative_variant>
```

**Examples:**

| Destination | UTM URL |
|-------------|---------|
| IG bio link | `whatajerk.berlin/?utm_source=instagram&utm_medium=social&utm_campaign=bio` |
| Meta ad — origin story reel | `whatajerk.berlin/menu?utm_source=meta&utm_medium=cpc&utm_campaign=launch&utm_content=origin_reel_30s` |
| Google Search ad | (Google auto-tags with `gclid` — don't override) |
| Newsletter | `whatajerk.berlin/?utm_source=newsletter&utm_medium=email&utm_campaign=opening_week` |
| Ssam flyer QR | `whatajerk.berlin/?utm_source=ssam&utm_medium=flyer&utm_campaign=cross_promo` |

Rule: never share an unurlled link to your site on a marketing surface. If it's not UTM-tagged, it's invisible.

### Step 6 — Instagram Insights (native)

Meta Business Suite auto-tracks this for you. Checkpoints:

- Content → Reels / Posts / Stories performance
- Audience → Demographics, active times, follower growth
- Profile activity → Link-in-bio clicks, profile visits (these are your best proxy for ad-driven intent)

### Step 7 — Google Business Profile (most under-used data source)

Log in monthly to see:
- How many people discovered you via search vs. maps
- What queries they used to find you ("jerk chicken berlin", "jamaican near me", etc.)
- How many clicked "directions", "website", "call"
- Photo views (yes, these matter — Google ranks active-photo profiles higher)

**Insight:** GBP data often correlates better with actual walk-ins than any web analytics data.

---

## Weekly Dashboard (Google Sheets)

Maintain one single-sheet dashboard. Update every Monday.

### Sheet structure

**Tab 1: Daily log**

| Date | Covers | Revenue | Dine-in | Takeaway | Wolt | UE | Punchcards issued | Punchcards redeemed | IG followers | Notes |
|------|--------|---------|---------|----------|------|-----|---------------------|----------------------|--------------|-------|
| 2026-05-14 | | | | | | | | | | |

**Tab 2: Weekly marketing**

| Week | IG followers | IG reach | IG profile visits | GBP views | GBP direction requests | Wolt rating | UE rating | Google reviews count | Google reviews avg | Meta spend | Meta CPC | Google spend | Google CPC | Blended CAC (ads-attributed) |
|------|--------------|----------|-------------------|-----------|------------------------|------------|----------|----------------------|--------------------|----------|----------|-------------|------------|----------------------------|

**Tab 3: Top items (weekly)**

| Item | Units sold | Revenue | % of total orders |
|------|-----------|---------|-------------------|

Use this for menu-engineering decisions (cut items that don't sell, double on items that do).

**Tab 4: "Source" log (opening month only)**

Staff asks 1-in-10 customers: "How did you hear about us?" Tally in categories:
- Instagram
- Walking by (saw signage)
- Google search
- Wolt / UE
- Friend recommendation
- Press (read an article)
- Other

After month 1, you'll know your organic channel mix. Drop this practice after.

---

## Decision Framework — Reading the Data

### Weekly questions to answer

1. **Revenue on track?** Daily revenue vs. €3,000 target. If below, why?
2. **Which channel is driving visits?** IG vs. Google vs. walk-by. Over-index on winners.
3. **Are we losing anyone?** Bad reviews? Wolt rating slipping? 1-star events?
4. **Ad efficiency?** Meta blended CPC + CPA — up or down from last week?
5. **Repeat behavior?** Punchcard redemptions growing? If not, why?

### Red flags (act within 48 hours)

- Google/Wolt/UE rating drops below 4.3
- Week-over-week revenue down > 20% (not holiday-explained)
- Meta CPC doubles in a week
- Negative review goes unresponded for > 24 hours
- IG follower growth flatlines for 2+ weeks

### Green lights (scale aggressively)

- IG post cracks 10k reach → boost it with €50 as a post-promote
- One specific ad creative has 3× CTR vs. others → lean budget into it
- A specific menu item has 30%+ order-attach rate → feature it on signage + Wolt listing
- Press feature drives detectable GA4 referral spike → pitch that outlet a follow-up angle

---

## Monthly Deep Review (end of each month)

Spend 90 minutes reviewing:

### 1. Marketing channel performance

| Channel | Spend | Attributed visits | Attributed revenue (estimated) | CPA |
|---------|-------|-------------------|-------------------------------|-----|
| Meta Ads | | | | |
| Google Ads | | | | |
| Instagram organic | €0 | | | — |
| Google Maps organic | €0 | | | — |
| Wolt marketplace | €30 boost | | | |
| UE marketplace | €30 boost | | | |
| Press coverage | €0 | | | — |
| Ssam cross-promo | €40 (flyer) | | | |

**Attribution approximation (not perfect):**
- `Directions_click` from GA4 + GBP direction requests ≈ walk-in intent
- Wolt + UE dashboard = direct delivery revenue
- Any "Instagram" or "walking by" mentions in source log = organic channels

### 2. Menu analysis

- Which items have highest margin?
- Which items are most popular?
- 2×2 grid: high-margin high-popular (lean in), low-margin low-popular (cut)

### 3. Customer mix

- Dine-in / takeaway / delivery — what's the ideal balance?
- If delivery is > 60%, you're losing community-building — push in-store more.
- If delivery is < 20%, ads aren't working — push Wolt promos.

### 4. Review sentiment

Read all new reviews from the month. Categorize:
- Food quality (good / bad)
- Service (good / bad)
- Price (complaints / praise)
- Heat (too much / too little / just right)

Turn common complaints into operational improvements.

### 5. Set next month's priorities

- 2–3 experiments to run (e.g., "add weekend brunch special", "try LinkedIn Ads for office catering")
- 2–3 ops improvements based on feedback

---

## Privacy & Compliance (Germany/EU)

GDPR is non-negotiable. Before launching:

- [ ] Cookie consent banner live (Cookiebot free tier OR Iubenda OR free alternatives)
- [ ] Privacy policy (`/datenschutz`) covers GA4, Meta Pixel, newsletter, Wolt/UE
- [ ] IP anonymization enabled in GA4
- [ ] Consent mode configured — tags wait for user consent before firing
- [ ] Meta Pixel events respect consent
- [ ] Newsletter double opt-in required (German law)
- [ ] Staff aware: never take photos of customers without permission

**Don't cheap out on this.** A single DSGVO complaint costs 4-digit euros and weeks of annoyance. One afternoon of proper setup saves you.

---

## Quick-Reference Dashboards (where to look for what)

| Question | Answer lives in |
|----------|----------------|
| "How many walk-ins today?" | POS covers count + GBP direction requests |
| "Is our IG growing?" | Meta Business Suite → Audience |
| "Which ad creative is working?" | Meta Ads Manager → Ads → breakdown by CTR |
| "How much revenue did Wolt drive?" | Wolt merchant dashboard → Sales tab |
| "What menu item is our hero?" | POS sales by item → sort by units |
| "Who's reviewing us?" | Google Business → Reviews tab |
| "Are we ranking for 'jamaican berlin'?" | Google Search Console → Queries |
| "Is any press writing about us?" | Google Alerts on "What a Jerk Berlin" + manual checks |

---

## What You Don't Need

- **Heatmaps** (Hotjar, Clarity) — not useful for a 6-page restaurant site
- **Session replay** — privacy overhead not worth it
- **Complex funnel tools** — GA4 Explore reports are enough
- **CRM** — until you hit 500+ newsletter subscribers, a Google Sheet and Mailchimp free is fine
- **A/B testing platform** — your data volume is too small for statistical significance until month 3+
- **Data warehouse** — you are not Netflix

Stay simple. Measurement overhead is the silent killer of small-business marketing.

---

## Month 6+ Evolution

Once you're stable:

- Consider a real CRM (HubSpot Free, Mailchimp tiers) if list > 1,000
- Consider Klaviyo if email becomes a major channel
- Consider lifetime value analysis — requires POS data export + sheet magic
- Consider Meta + Google ad budget scaling tests (small incremental lifts)
- Consider catering-funnel analytics as B2B becomes a real line of revenue

---

## Opening Day Checklist — Data Stack

- [ ] GA4 live, tested, conversions marked
- [ ] GTM live, all tags firing
- [ ] Meta Pixel firing on all pages
- [ ] Meta CAPI configured
- [ ] Google Ads tag live
- [ ] Cookie consent banner live (Cookiebot / similar)
- [ ] Privacy policy live
- [ ] All outbound links UTM-tagged
- [ ] Google Search Console verified + sitemap submitted
- [ ] Bing Webmaster verified
- [ ] Google Business Profile insights accessible
- [ ] Meta Business Suite set up with FB + IG linked
- [ ] Wolt merchant dashboard accessible to Ethan + one staffer
- [ ] UE merchant dashboard same
- [ ] Weekly dashboard Google Sheet created + shared with the team
- [ ] "Source" clipboard tracker printed + on counter for week 1
