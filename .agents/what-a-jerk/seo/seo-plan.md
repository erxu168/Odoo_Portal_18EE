# SEO Plan — What a Jerk

*Covers: local SEO (Google Business, citations), on-page SEO, schema, and AI-SEO (getting cited by ChatGPT / Perplexity / Google AI Overviews).*

---

## Priority Order for a New Local Restaurant

For a QSR in Berlin, the impact order is:

1. **Google Business Profile** — 50% of your traffic comes from here. Dominant for "near me" searches.
2. **Reviews (Google + Wolt + UE + Tripadvisor)** — Ranking signal + trust signal.
3. **Local citations** (consistent NAP across directories) — Trust signal.
4. **On-page SEO** for whatajerk.berlin — Rankings on "jamaican food berlin" etc.
5. **Schema markup** — Rich results + AI extraction.
6. **AI-SEO** — getting cited when Berliners ask ChatGPT "best Jamaican food in Berlin."
7. **Backlinks / press mentions** — Sustained authority.
8. **Content marketing (blog)** — Only later, only if committed.

---

## 1. Google Business Profile (highest priority)

### Setup checklist

- [ ] Claim `What a Jerk` on Google Business Profile (Week -3)
- [ ] Verify via postcard or phone once location is physical (takes 5–14 days — start early)
- [ ] Complete every field (Google rewards 100% completeness)
- [ ] Upload 20+ photos (covered in `/copy/listings.md`)
- [ ] Set service areas if delivery is broader than storefront address
- [ ] Add attributes: Dine-in · Takeaway · Delivery · Vegan options · Accepts credit cards · Outdoor seating (if true) · Wheelchair accessible
- [ ] Enable messages + Q&A
- [ ] Link to website + menu URL + Wolt + Uber Eats
- [ ] Enable Google Reserve / booking (optional)

### Weekly rituals (5 min each Monday)

- Post a weekly update in GBP ("This week: new patty flavor" / "Open late Fri + Sat")
- Reply to every new review (good + bad) within 24 hours
- Upload 1 new photo
- Answer any new Q&A
- Check "Insights" tab — note how many searches, calls, direction-requests

### Review goal

| Milestone | Target | Timeline |
|-----------|--------|---------|
| First 5 reviews | 4.5+ avg | Week 1 |
| 20 reviews | 4.5+ avg | Month 1 |
| 50 reviews | 4.5+ avg | Month 3 |
| 100+ reviews | 4.5+ avg | Month 6 |

### How to get reviews (ethically)

- Include "Leave us a Google review" on every receipt with QR code
- QR link: `g.page/r/[YOUR_GBP_ID]/review` (the direct-review URL)
- Train counter staff: "If you enjoyed it, a Google review helps us a lot."
- **Do not** offer discounts for reviews (violates Google's policy + gets detected)
- **Do not** write fake reviews (instant deplatforming)

### Responding to bad reviews

| Bad review scenario | Response |
|---------------------|----------|
| "Too spicy" | "Thanks for trying us. Next time let us know and we'll mild it down — we list four heat levels on the menu. Come back soon. — Ethan" |
| "Slow service" | "I'm sorry about the wait. Opening week ops are tight. If you come back, ask for me. — Ethan" |
| "Didn't like the food" | "Thanks for coming in and sharing this. If you're open to it, I'd love to hear what you ordered and what didn't work — ethan@whatajerk.berlin." |
| "Too expensive" | Don't respond. Price-complainers self-sort out. |

Keep responses under 30 words, sign your name, offer to fix it.

---

## 2. Local Citations (NAP consistency)

NAP = Name · Address · Phone. These must match EXACTLY across the web.

**Canonical format (use everywhere, no variation):**
```
What a Jerk
Kottbusser Damm 96
10967 Berlin
+49 [XXX XXXXX]  (or keep blank until number ready)
```

### Citation sites to submit (priority order)

**Tier 1 (must-do, free):**
1. Google Business Profile ✓
2. Apple Maps / Apple Business Connect
3. Bing Places
4. Facebook Page
5. Wolt merchant listing
6. Uber Eats merchant listing
7. Tripadvisor (claim once open)
8. Yelp (claim once open)

**Tier 2 (Berlin-specific):**
9. OpenTable (even if you don't use reservations — creates a listing)
10. Fünf Sterne Berlin
11. Foursquare / Swarm
12. Visit Berlin business listing
13. Das Telefonbuch
14. Gelbe Seiten
15. 11880.com

**Tier 3 (nice-to-have):**
16. HappyCow (vegan listing for jackfruit dish)
17. The Fork
18. Trustpilot (for platform reviews if used)
19. Quandoo
20. Resy Berlin

**Never submit to** shady "local directory" sites that auto-generate listings and ask for payment — they provide zero SEO value and are often flagged by Google.

---

## 3. On-Page SEO for whatajerk.berlin

### Target keywords by page

| Page | Primary target | Secondary | Search intent |
|------|---------------|-----------|---------------|
| `/` | jamaican food berlin | jamaikanisches restaurant berlin · jerk chicken berlin | discovery |
| `/menu` | jamaican food menu berlin | jerk chicken berlin preis · curry goat berlin | evaluation |
| `/story` | what a jerk berlin owner · jamaican restaurant kottbusser damm | — | brand |
| `/press` | what a jerk berlin press | — | brand |
| `/contact` | jerk chicken kottbusser damm · jerk chicken neukölln | jamaikanisches essen kreuzberg | local intent |

### Title tag + meta description formulas (already drafted in `/website/site-plan.md`)

### On-page checklist per page

- [ ] Unique title (50–60 chars)
- [ ] Unique meta description (150–160 chars)
- [ ] One H1 per page, matches title
- [ ] H2s match search-intent phrases ("Where are you located?", "What is jerk chicken?")
- [ ] Alt text on every image — descriptive, includes dish name when appropriate ("jerk chicken wrap with slaw and escovitch")
- [ ] Internal links (see `/website/site-plan.md` map)
- [ ] External links open in new tab (Wolt, UE, IG)
- [ ] Mobile-first responsive
- [ ] Page loads under 2.5s (LCP)
- [ ] Single canonical URL (no `/index.html` / `/home` variants)

### Keywords to AVOID stuffing

Google and AI systems actively penalize keyword stuffing. **Keyword stuffing reduces AI visibility by 10%** per Princeton GEO research. Don't write:

> "Looking for the best Jamaican food in Berlin? What a Jerk is the best Jamaican restaurant in Berlin serving the best Jamaican food in Berlin near Kottbusser Damm."

Write instead:

> "What a Jerk is Berlin's first proper Jamaican quick-service spot, serving jerk chicken wraps, curry goat, and oxtail stew on Kottbusser Damm."

---

## 4. Schema Markup (Structured Data)

Restaurant schema is one of the strongest local SEO tools. It powers rich results in Google Search + feeds AI extraction.

Add JSON-LD to every page's `<head>`.

### Homepage — Restaurant + LocalBusiness schema

```json
{
  "@context": "https://schema.org",
  "@type": "Restaurant",
  "@id": "https://whatajerk.berlin/#restaurant",
  "name": "What a Jerk",
  "image": [
    "https://whatajerk.berlin/images/hero-wrap.jpg",
    "https://whatajerk.berlin/images/storefront.jpg",
    "https://whatajerk.berlin/images/kitchen.jpg"
  ],
  "description": "Berlin's first proper Jamaican quick-service restaurant. Jerk chicken wraps, curry goat, oxtail stew, patties, and real scotch-bonnet heat on Kottbusser Damm.",
  "url": "https://whatajerk.berlin",
  "telephone": "+49XXXXXXXXXX",
  "priceRange": "€€",
  "servesCuisine": ["Jamaican", "Caribbean"],
  "menu": "https://whatajerk.berlin/menu",
  "acceptsReservations": "False",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Kottbusser Damm 96",
    "addressLocality": "Berlin",
    "postalCode": "10967",
    "addressCountry": "DE",
    "addressRegion": "Berlin"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": 52.4899,
    "longitude": 13.4225
  },
  "openingHoursSpecification": [
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Sunday"],
      "opens": "12:00",
      "closes": "23:00"
    },
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": ["Friday", "Saturday"],
      "opens": "12:00",
      "closes": "01:00"
    }
  ],
  "sameAs": [
    "https://www.instagram.com/whatajerkberlin",
    "https://www.tiktok.com/@whatajerkberlin",
    "https://wolt.com/de/deu/berlin/restaurant/whatajerk",
    "https://ubereats.com/de/store/what-a-jerk"
  ],
  "hasMenu": {
    "@type": "Menu",
    "name": "What a Jerk Menu",
    "url": "https://whatajerk.berlin/menu"
  }
}
```

### Menu page — Menu + MenuItem schema

```json
{
  "@context": "https://schema.org",
  "@type": "Menu",
  "name": "What a Jerk Menu",
  "description": "Full menu of jerk chicken wraps, dishes, patties, sides, and drinks.",
  "inLanguage": ["en", "de"],
  "hasMenuSection": [
    {
      "@type": "MenuSection",
      "name": "Wraps",
      "hasMenuItem": [
        {
          "@type": "MenuItem",
          "name": "Jerk Chicken Wrap",
          "description": "Smoky grilled jerk chicken, slaw, escovitch pickle, and jerk aioli in a warm wrap.",
          "offers": { "@type": "Offer", "price": "8.50", "priceCurrency": "EUR" },
          "suitableForDiet": "https://schema.org/GlutenFreeDiet"
        }
      ]
    }
  ]
}
```

### FAQ page (add FAQPage schema anywhere you list FAQs)

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is jerk chicken?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Jerk chicken is a Jamaican preparation of chicken marinated in a blend of allspice, scotch bonnet pepper, thyme, and garlic, then grilled over wood or charcoal. The style originated with Maroons in Jamaica's Blue Mountains and is the signature dish of Jamaican cuisine."
      }
    },
    {
      "@type": "Question",
      "name": "How spicy is What a Jerk?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "We offer four heat levels: mild (no scotch bonnet), medium (our default), jerk (traditional), and full fire (for the bold). You can adjust heat on any dish at the counter or in the order notes."
      }
    },
    {
      "@type": "Question",
      "name": "Do you have vegan options?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. Our Jackfruit Stew wrap (€8.50) and dish (€12) are fully plant-based. The Veggie Patty is also vegan. Sides including rice and peas, fried plantain, and festival are vegan-friendly."
      }
    }
  ]
}
```

### Organization schema (site-wide)

```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "What a Jerk",
  "url": "https://whatajerk.berlin",
  "logo": "https://whatajerk.berlin/logo.png",
  "sameAs": [
    "https://www.instagram.com/whatajerkberlin",
    "https://www.facebook.com/whatajerkberlin"
  ]
}
```

### BreadcrumbList (each inner page)

```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://whatajerk.berlin/" },
    { "@type": "ListItem", "position": 2, "name": "Menu", "item": "https://whatajerk.berlin/menu" }
  ]
}
```

### Testing

Validate every page using Google's Rich Results Test + Schema.org Validator. Fix all errors before launch.

---

## 5. AI-SEO — Getting Cited by ChatGPT / Perplexity / AI Overviews

**Why this matters:** When Berliners ask ChatGPT "best Jamaican food in Berlin", the answer shapes foot traffic. Perplexity and Google AI Overviews behave the same way. Citations are the new ranking.

### How AI search picks restaurants

AI systems cite sources based on:
1. **Structure** — Can they extract a clean answer? (Menu schema, FAQ schema, clear H2s)
2. **Authority** — Is your brand mentioned on Wikipedia, Reddit, local blogs?
3. **Presence** — Do you appear on Tripadvisor, Yelp, Wolt, local-best lists?

### Target queries to win

**Exact queries you want to be cited on:**

| Query | Platform | Current state | Actions |
|-------|----------|---------------|---------|
| "Best Jamaican food in Berlin" | ChatGPT, Perplexity, AI Overviews | You don't exist yet | Get listed on Tripadvisor, Yelp, local press roundups |
| "Jerk chicken Berlin" | all | — | Same + on-site content optimized |
| "Jamaican restaurant Neukölln" | all | — | Google Business + citations |
| "Where to eat late night Neukölln" | ChatGPT especially | — | Late-night press angle, Mit Vergnügen late-night roundups |
| "Best curry goat Berlin" | Perplexity | — | Menu schema + blog post "Where to Find Curry Goat in Berlin" (later) |
| "Berlin Caribbean food" | all | — | Same |
| "Vegan Jamaican Berlin" | all | — | HappyCow listing + vegan-angled content |

### Monthly AI visibility check

Each month, run these queries through ChatGPT, Perplexity, Google (on incognito), Gemini, Claude:

1. "Best Jamaican food in Berlin"
2. "Jerk chicken restaurant Berlin"
3. "Jamaican restaurant Neukölln"
4. "Where to eat near Kottbusser Damm"
5. "Best late-night food Berlin"
6. "Caribbean restaurant Berlin"
7. "Vegan Jamaican Berlin"
8. "What a Jerk Berlin" (your own brand)

Log in a spreadsheet: are you cited? which URL? what's the sentiment? who are you losing to?

### How to get cited

1. **Robots.txt allows AI crawlers** — verify `GPTBot`, `PerplexityBot`, `ClaudeBot`, `Google-Extended` are not disallowed.
   ```
   # whatajerk.berlin/robots.txt
   User-agent: *
   Allow: /
   Sitemap: https://whatajerk.berlin/sitemap.xml
   ```
   Do not add `Disallow` lines for AI bots.

2. **Be present on third-party authority sources:**
   - **Tripadvisor** — biggest restaurant citation source for AI. Claim + fully complete.
   - **Yelp** — second biggest. Same.
   - **Wolt + UE** — AI systems read these listings.
   - **The-Berliner.com** "best of" lists — pitch to be included.
   - **Berlin Food Stories** — get a feature.
   - **Reddit /r/berlin** — participate authentically. If someone asks "where's the best jerk chicken?", reply from owner account with "I opened What a Jerk recently — happy to answer any questions. No self-promo, just hope it helps."

3. **Structure on-site content for AI extraction:**
   - Use direct-answer leads on every section ("What a Jerk is a Jamaican quick-service restaurant at Kottbusser Damm 96, Berlin.")
   - Add an FAQ page with FAQPage schema (see above)
   - Use tables for comparison data (menu, heat levels)
   - Add dates to pages ("Last updated: April 2026")

4. **Add statistics + citations where possible:**
   - "Berlin has fewer than 10 dedicated Jamaican restaurants, according to [source]."
   - "Jerk chicken originated with Jamaica's Maroon community in the Blue Mountains."
   - Link out to authoritative sources (Wikipedia, food publications) — AI systems reward outbound citations.

5. **Get on "best of" third-party lists:**
   - Mit Vergnügen "Best new openings" — pitch
   - Berlin Food Stories "new restaurants 2026" — pitch
   - Exberliner "late-night food" list — pitch late-night angle
   - The Berliner "best Jamaican in Berlin" — pitch (might need to earn it over time)
   - Reddit threads about Berlin food — participate

### Wikipedia

Long-term: a Wikipedia entry is the single highest-value AI-citation asset you can earn. Too early for What a Jerk (Wikipedia requires notability — meaning independent press coverage). But as press coverage builds over months:
- Keep a press list / PDF archive
- After 6+ months and 5+ notable press mentions, consider commissioning a Wikipedia page (or let a journalist or fan create one — editors reject pages created by the subject itself).

---

## 6. Backlinks & Press Mentions

Citations from authoritative local sites compound. Target:

| Source type | Example | Value |
|------------|---------|-------|
| Major Berlin publication | The-Berliner, tip Berlin, Mit Vergnügen, rbb24 | Very high (dofollow + AI citation source) |
| Food blog | Berlin Food Stories, Finding Berlin | High |
| Lifestyle blog | Iheartberlin, Überlin | Medium |
| Local government | Visit Berlin, Berlin.de | Very high (.de.gov equivalent) |
| Industry body | IHK Berlin, DEHOGA (hotel/restaurant assoc.) | Medium |
| Other restaurants | Ssam website linking to sister location | Low but easy |

### Pitching backlinks

When press writes about you, politely ask: "Any chance you can include a link to our website?" Most will. No link = pure SEO loss.

### Guest content opportunities

- Pitch a guest essay to Berlin Food Stories: "From Vancouver to Kotti Damm: Why Jamaican Food Belongs in Berlin"
- Pitch a Q&A to Exberliner about being a Chinese-born restaurateur opening a Jamaican spot
- Podcast: Berlin Uncut, The Berliner's podcast

---

## 7. Content Marketing (Phase 2 — Month 3+)

**Skip for now.** A dead blog hurts SEO. Only start if you commit to 1 post/month minimum for 12 months.

If/when you do:

### Topic cluster: Jamaican food in Berlin

Pillar post: "A Guide to Jamaican Food in Berlin" (long-form, 2,000 words)

Supporting posts:
- "What is Jerk Chicken? A Guide for Berliners"
- "The Story of Curry Goat — and Where to Eat It in Berlin"
- "Scotch Bonnet vs Habanero: Heat Levels Explained"
- "Jamaican Patties: Berlin's Döner Alternative"
- "Late-Night Food in Neukölln: A Survival Guide"

Each supporting post links to the pillar. Each pillar links to your menu + about page. Internal links = SEO compound interest.

---

## 8. Launch-Day SEO Checklist

Before `whatajerk.berlin` goes live:

- [ ] All 6 pages live (home, menu, story, press, contact, legal)
- [ ] Title tags + meta descriptions on every page
- [ ] H1 on every page, matches intent
- [ ] Alt text on every image
- [ ] Internal links set up per `/website/site-plan.md`
- [ ] Schema markup validated on all pages (Rich Results Test)
- [ ] Robots.txt open to AI crawlers
- [ ] XML sitemap generated + submitted to Google Search Console
- [ ] Mobile performance >90 Lighthouse
- [ ] Page load <2.5s LCP
- [ ] Core Web Vitals passing
- [ ] Google Analytics 4 installed
- [ ] Google Search Console verified
- [ ] Bing Webmaster Tools verified
- [ ] Google Business Profile linked to website
- [ ] Schema.org address matches GBP exactly
- [ ] HTTPS (SSL) active
- [ ] Canonical URLs set
- [ ] Open Graph tags on every page
- [ ] Twitter card tags on every page
- [ ] Favicon all sizes
- [ ] Impressum + Datenschutz live (GDPR)
- [ ] Cookie banner active

---

## 9. Ongoing SEO Operations

### Weekly (~15 min)

- Check Search Console for crawl errors
- Check new reviews on Google, Wolt, UE, Tripadvisor — respond to all
- Upload 1 new photo to GBP
- Post a weekly GBP update
- Check for citation inconsistencies (NAP mismatches)

### Monthly (~60 min)

- AI visibility check (run 8 target queries through ChatGPT/Perplexity/AI Overviews, log results)
- Competitor check — what are Sweet Jamaica, Rosa Caleta, Good Vybz ranking for?
- Google Search Console — which queries are driving impressions/clicks?
- GA4 — referral traffic, top pages, bounce rate
- Update any outdated content (menu prices, hours)
- One new blog post or press pitch (if committed to content)

### Quarterly (~2 hours)

- Full site audit (use free Screaming Frog, limit 500 URLs)
- Backlink audit (Ahrefs Webmaster Tools — free tier)
- Schema validation sweep
- Speed audit (Lighthouse, Core Web Vitals report)
- Refresh Story + Press pages with latest coverage

---

## 10. Red Flags / Avoid

- **Don't buy backlinks.** Google detects + penalizes. Especially from "cheap SEO" packages.
- **Don't write fake reviews.** Platform-level deplatforming risk.
- **Don't duplicate content from Sweet Jamaica or other Jamaican spots.** Duplicate penalty.
- **Don't keyword-stuff.** Reduces AI visibility and reads badly.
- **Don't ignore bad reviews.** Not responding looks worse than responding poorly.
- **Don't change your NAP without updating everywhere.** NAP inconsistency tanks local rankings.
- **Don't hide prices.** AI systems reward transparent pricing.
- **Don't gate menu behind signup.** AI can't extract it; humans bounce.

---

## 11. Metrics to Track (SEO-specific)

| Metric | Tool | Target (Month 3) |
|--------|------|----------------|
| Ranking for "jamaican food berlin" | Semrush / Ahrefs / manual | Top 10 |
| Ranking for "jerk chicken berlin" | Same | Top 5 |
| GBP impressions | Google Business Insights | 3,000+/month |
| GBP direction requests | GBP | 300+/month |
| GBP phone calls | GBP | 50+/month |
| Google review count | GBP | 50+ |
| Google review avg rating | GBP | 4.5+ |
| Organic search traffic | GA4 | 1,500+/month |
| AI citation rate (for target queries) | Manual log | 3+ of 8 queries citing you |
| Backlinks (referring domains) | Ahrefs free | 10+ from local sites |
