# Wardrobec

A personal wardrobe assistant. It knows every item you own and, each morning, proposes four complete outfits (Gym, Casual, Business Casual, Formal) adjusted to the day's weather, plus a dedicated outfit for anything on your calendar.

No external runtime dependencies: Node 22's built-in HTTP server and SQLite driver, a vanilla-JS front end, and the free, keyless [Open-Meteo](https://open-meteo.com) API for weather.

## Run it

```bash
npm start            # http://127.0.0.1:3000
npm run seed         # optional: load the 80-piece sample closet
npm test             # engine, classifier and API tests
```

Requires Node 22.13 or newer (for `node:sqlite`). Data lives in `data/wardrobe.db`; set `WARDROBE_DB`, `PORT` or `HOST` to change defaults.

First run: open **Settings** and search your city so the forecast can load. Then open **Closet** and use **Quick add** to paste your clothes one per line ("navy wool blazer", "grey running shorts"). The classifier fills in category, colour, formality, warmth and rain-readiness; correct anything it guesses wrong.

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

**Your personal colour profile** (Settings → Style profile) rates every colour family from -3 to +3, with shade-level overrides ("icy blue" good, "warm beige" bad, "cool red" good, "rusty red" bad) matched against an item's colour or name. Ratings are weighted by how close a piece sits to the face: tops, layers and ties count most, shoes least. A high-contrast profile also rewards the formula of a dark base, crisp white and one jewel-tone accent, and flags mid-tone-only outfits as flat. The Deep Winter preset is built in; every rating is editable. Closet items show a flatters / good / muted / avoid chip so you can see how the engine reads each piece.

**Calendar events** get their own outfit using the hourly forecast at the event time, and outfits for events on the same day never share pieces, because you will actually wear all of them.

**Wear this** logs the outfit, bumps wear counts, and marks pieces dirty once they hit their wash threshold. Dirty items drop out of suggestions until **Laundry done**.

**Coverage** (Closet page) runs the engine across every occasion × temperature band × dry/rain and shows where the closet cannot produce a solid outfit, so you know what to buy next.

## Layout

```
server/
  index.js     HTTP server and static files
  routes.js    JSON API
  engine.js    outfit scoring and search (pure functions)
  classify.js  free-text → item attributes
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
| `POST /api/outfits/feedback` | Like / dislike a combination |
| `GET/POST/PUT/DELETE /api/items` | Inventory; `POST /api/items/classify` and `/bulk` for quick add |
| `GET/POST/DELETE /api/events` | Calendar entries with a dress code |
| `GET /api/weather`, `PUT /api/weather/override` | Forecast and manual weather |
| `GET /api/coverage` | Gap analysis |
| `GET /api/profiles`, `PUT /api/settings { style_profile }` | Colour profile presets and the active profile |
| `GET /api/export`, `POST /api/import` | Backup and restore |

## Ideas not yet built

Calendar sync (ICS or Google Calendar), per-item photos from a phone camera flow, packing lists for trips, and a learned colour model from your feedback instead of fixed rules.
