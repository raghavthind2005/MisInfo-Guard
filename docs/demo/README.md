# Demo captures

Every image here was recorded with the built extension loaded in Chromium, using the Balanced budget, a Gemini key and a Tavily key. 

How the recordings were made:

- **Captured on 11 October 2026.** Live search results change, so a later run may flag different sentences.
- **Cookie banners and ad frames were hidden** so the article text is visible.
- **The fact-check database was built locally** with `scripts/build_factcheck_index.py`, the same script the publishing workflow runs.
- **The third scene is a test article,** not a real site. The first two are real pages.

## 1. An article repeating a debunked claim

![The headline and several sentences turn red, each with the fact-check it matches](misinformation.gif)

Each tooltip shows the published fact-check it matches and that fact-checker's rating.

| Headline | Body |
|---|---|
| ![The headline flagged, with a fact-check tooltip](misinformation-headline.png) | ![A body sentence flagged, with a fact-check tooltip](misinformation-body.png) |

## 2. A real BBC News article

![Nothing is flagged, and one sentence is marked as supported](reputable.gif)

Nothing is flagged. One sentence is marked as supported, with the matching passage from NPR's report of the same story.

![The supported sentence and its tooltip quoting NPR](reputable-supported.png)

## 3. A test article with two altered figures

![Two altered figures turn red, with the article's number beside the source's](figures.gif)

The page describes Tesla's real third-quarter 2026 deliveries, with two figures changed. Both altered sentences turn red, and the tooltip shows the article's number beside the source's. The unaltered sentences turn green.

| First altered figure | Second altered figure | An unaltered sentence |
|---|---|---|
| ![12% in the article against 2% in the source](figures-1.png) | ![561,100 in the article against 461,100 in the source](figures-2.png) | ![A sentence marked as supported](figures-supported.png) |

## Options page and popup

| Options | Popup |
|---|---|
| <img src="options.png" alt="API keys, budget presets, usage and the fact-check database" width="420"> | <img src="popup.png" alt="The toolbar popup" width="260"> |
