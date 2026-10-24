# Wardrobec

A personal wardrobe assistant. It knows every item you own and, each morning, proposes four complete outfits (Gym, Casual, Business Casual, Formal) adjusted to the day's weather, plus a dedicated outfit for anything on your calendar.

No external runtime dependencies: Node 22's built-in HTTP server and SQLite driver, a vanilla-JS front end, and the free, keyless [Open-Meteo](https://open-meteo.com) API for weather.

## Run it

```bash
npm start            # http://127.0.0.1:3000
npm run seed         # optional: load the 80-piece sample closet (Closet → More… also offers the 20-piece capsule)
npm test             # engine, classifier and API tests
```

Requires Node 22.13 or newer (for `node:sqlite`). Data lives in `data/wardrobe.db`; set `WARDROBE_DB`, `PORT` or `HOST` to change defaults.

**Your own closet file**: `data/my-closet.json` holds the owner's pieces with photos under `public/images/closet/`. Load it from Closet → More… → Load my closet file (idempotent; pieces already present are skipped). Add new pieces to the file or straight in the app.

**Add from links** (Closet page) takes product URLs from the stores you bought from. Any Shopify store resolves to the exact variant colour, photo and brand when the link carries a `?variant=` id. Other stores (Lululemon, Nike and the like) are read from the page's product metadata (JSON-LD and Open Graph); a `color=` code keeps each link a distinct item, and a colour the page does not expose is flagged for you to set. Athletic brands classify tops, shorts and shoes as gym-ready.

First run: open **Settings** and search your city so the forecast can load. Then open **Closet** and use **Quick add** to paste your clothes one per line ("navy wool blazer", "grey running shorts"). The classifier fills in category, colour, formality, warmth and rain-readiness; correct anything it guesses wrong.

## Deploying (Railway and similar)

The app has no build step and no dependencies. On a platform that sets `PORT`, the server binds to all interfaces automatically. `nixpacks.toml`, `.node-version` and `railway.json` pin Node 22 and the start command. Two settings matter:

- **Persist the database.** The container filesystem is wiped on every deploy. Add a volume (for example mounted at `/data`) and set `WARDROBE_DB=/data/wardrobe.db`. Without it the closet, history and Fab outfits reset on each deploy; the closet file can be reloaded from the Closet menu, but history cannot.
- **No API keys.** Weather comes from Open-Meteo, which needs none. The `npm warn config production` line in build logs is harmless.

## How it decides

**Every item carries a small model of itself.**

| Attribute | Scale | Meaning |
|---|---|---|
| `formality_min` / `formality_max` | 0–5 | 0 athletic, 1 casual, 2 smart casual, 3 business casual, 4 business formal, 5 black tie |
| `warmth` | 1–5 | 1 hot-weather piece, 3 mild, 5 deep cold |
| `rain_ok`, `wind_ok` | bool | Can it get wet, does it block wind |
| `occasions` | tags | Explicit tags override the formality band |
| `set_id` | text | Pairs a suit jacket with its trousers so they are never split |
| `wears_before_wash` | 1–999 | Laundry threshold: shirts 1, jeans 4, shoes never |

**Each occasion is a dress-code band:** Gym 0, Casual 1–2, Business Casual 3, Formal 4–5. Items outside the band are ineligible (gym shorts never reach a formal outfit); items one step outside are allowed with a penalty when nothing better exists.

**Weather sets a warmth target.** The day-weighted apparent temperature maps to a target on the same 1–5 scale (82°F → 1, 54°F → 3, 26°F → 5). The engine stacks top, layer and outerwear to hit it, penalising both under- and over-dressing. Rain above ~45% prefers rain-ready shoes and outerwear and adds an umbrella; snow demands boots; wind favours shells. Gym targets are damped because you warm up.

**Then it searches.** The best candidates per slot are enumerated in combination and scored on: formality fit, warmth balance, rain and wind handling, colour harmony (clashing pairs, three or more loud colours, brown shoes with black trousers), pattern collisions, split suits, pieces worn in the last few days, laundry state, favourites, and your Like/Dislike history for that occasion. A seeded random jitter keeps each day stable while **Regenerate** produces a genuinely different answer.

**The style guide is the stylist's base programming.** `server/styleguide.js` encodes the owner's personal style guide: the philosophy (athletic-tailored fit, restrained palette, simple layering, quality footwear, minimal accessories), the palette, and the eight outfit formulas (Polished Work, Business Casual, Casual Friday, Weekend, Date Night, School Event, Travel, Dinner). Each formula lists the garment types that belong in each slot; the engine rewards pieces on the list and penalises pieces off it, drops layers the look does not use, and enforces the guide's rules (one accent colour, no casual jacket over a blazer). Every daily option is built to the closest look, calendar events can name a look outright, and the **Looks** page arranges the closet into all eight for any date. The rationale speaks in the guide's voice: formula first, then why it works, then the weather. Settings also audits the guide's 20-piece capsule against the closet live: owned, covered by a stand-in, or missing.

**Your personal colour profile** (Settings → Style profile) rates every colour family from -3 to +3, with shade-level overrides ("icy blue" good, "warm beige" bad, "cool red" good, "rusty red" bad) matched against an item's colour or name. Ratings are weighted by how close a piece sits to the face: tops, layers and ties count most, shoes least. A high-contrast profile also rewards the formula of a dark base, crisp white and one jewel-tone accent, and flags mid-tone-only outfits as flat. The Deep Winter preset is built in; every rating is editable. Closet items show a flatters / good / muted / avoid chip so you can see how the engine reads each piece.

Four presets ship: **Personal Style Guide** (the default, the guide's own palette), **Deep Winter** and **Deep Autumn**, each built from one of the owner's colour reports, and **Shared ground**, which rewards only the colours both reports agree on (navy, charcoal, olive, forest, burgundy, deep blue, espresso) and leaves contested colours neutral.

Events can also carry a **lean**: relaxed pulls toward tees and sneakers, elevated toward henleys and boots, within the same dress-code band. Date night and weekend errands are both casual; the lean is what separates them.

**Calendar events** get their own outfit using the hourly forecast at the event time, and outfits for events on the same day never share pieces, because you will actually wear all of them.

**Love it / Never again.** Love it saves the exact outfit to the **Fab** tab and gives that combination a strong bonus, so it returns whenever weather and laundry allow; Fab outfits can be named and worn directly. Never again bans the exact combination and makes the engine wary of the pairs inside it, so a near-copy does not come straight back. Loving a banned combo lifts the ban; banning a Fab outfit removes it.

**Pack** builds a trip bag: give it days, expected high and low, rain chance, whether laundry is available, and how many of each look you need. The planner fills the most constrained outfits first and rewards reusing anything already packed; shirts serve one outfit, bottoms and layers several, shoes and outerwear all of them. It tries several orderings and keeps the smallest bag, then shows the bag grouped by category with how many outfits each piece serves.

**Wear this** logs the outfit, bumps wear counts, and marks pieces dirty once they hit their wash threshold. Dirty items drop out of suggestions until **Laundry done**.

**Coverage** (Closet page) runs the engine across every occasion × temperature band × dry/rain and shows where the closet cannot produce a solid outfit, so you know what to buy next.

## Layout

```
server/
  index.js     HTTP server and static files
  routes.js    JSON API
  engine.js    outfit scoring and search (pure functions)
  classify.js  free-text → item attributes
  links.js     product links (Shopify variants) → item drafts
  profile.js   personal colour profile presets and palette rating
  weather.js   Open-Meteo client, cache, manual override
  store.js     SQLite queries, wear logging, laundry
  db.js        schema
  seed.js      sample closet
public/        single-page UI (index.html, app.js, styles.css)
test/          node:test suites
```

## API sketch

| Endpoint | Purpose |
|---|---|
| `GET /api/plan?date=` | Weather, four standard outfits, event outfits, what was worn |
| `POST /api/outfits/generate` | One outfit with `lock` (pin slots), `exclude`, `attempt` |
| `POST /api/outfits/wear` | Log an outfit and update laundry state |
| `POST /api/outfits/feedback` | Love it (saves to Fab) or never again (bans the combo) |
| `GET/PUT/DELETE /api/fab`, `POST /api/fab/:id/wear` | Saved outfits |
| `POST /api/pack` | Trip packing plan |
| `GET/POST/PUT/DELETE /api/items` | Inventory; `POST /api/items/classify`, `/from-links` and `/bulk` for bulk entry |
| `GET/POST/DELETE /api/events` | Calendar entries with a dress code |
| `GET /api/weather`, `PUT /api/weather/override` | Forecast and manual weather |
| `GET /api/coverage` | Gap analysis |
| `GET /api/profiles`, `PUT /api/settings { style_profile }` | Colour profile presets and the active profile |
| `GET /api/export`, `POST /api/import` | Backup and restore |

## Ideas not yet built

Calendar sync (ICS or Google Calendar), per-item photos from a phone camera flow, packing lists for trips, and a learned colour model from your feedback instead of fixed rules.
