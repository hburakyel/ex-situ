# Ex Situ — Collection Roadmap

Current (15 October 2026): **280,763 artifacts on the map · 61 collections · 203 territories · 6,179 origin sites**

318,828 records are indexed. The others have no located origin in their institution's record yet, have a point but no territory that can be assigned without guessing (regions such as Polynesia, or a place name that does not match its point), or are parts of one object that share an inventory number and are counted once. 10 collections are indexed directly, 51 via Europeana.

This document tracks indexed collections, planned integrations, and contribution priorities.

---

## Indexed Collections

| # | Institution | Location | Artifacts | Method | Status |
|---|-------------|----------|---------|--------|--------|
| 1 | Ethnologisches Museum | Berlin | 76,990 | SMB API | ✅ Live |
| 2 | Victoria and Albert Museum | London | 21,497 | REST API | ✅ Live |
| 3 | The Metropolitan Museum of Art | New York | 19,587 | REST API (CC0) | ✅ Live |
| 4 | Ägyptisches Museum und Papyrussammlung | Berlin | 6,328 | SMB API | ✅ Live |
| 5 | Museum für Islamische Kunst | Berlin | 12,409 | SMB API | ✅ Live |
| 6 | Antikensammlung | Berlin | 5,613 | SMB API | ✅ Live |
| 7 | Museum für Asiatische Kunst | Berlin | 2,693 | SMB API | ✅ Live |
| 8 | Vorderasiatisches Museum | Berlin | 1,061 | SMB API | ✅ Live |
| 9 | Art Institute of Chicago | Chicago | 33,890 | REST API (CC0) | ✅ Live |
| 10 | Rijksmuseum | Amsterdam | 54,719 | OAI-PMH (EDM, open data) | ✅ Live |

---

## Via Europeana — live since October 2026

Europeana is the access route, not a collection: each record is attributed to its holding institution
(`dataProvider`) and links to that institution's own page. Resolver: `etl/scrape_europeana.py`
(scan of October 2026). Indexed are objects whose origin the institution's own record places outside
Europe, that can be mapped (origin point and museum location known) and whose image loads on Ex Situ
(`etl/check_europeana_images.py`), excluding SMB, V&A, Met and AIC (indexed directly), natural-history
providers, and objects held in their country of origin. Each image is credited with its own licence.

84,041 objects from 51 institutions (the Rijksmuseum, first reached this way, is now indexed directly):

| # | Institution | Location | Artifacts |
|---|-------------|----------|-----------|
| 1 | Museum of Ethnography | Stockholm, Sweden | 29,514 |
| 2 | The Museum of Mediterranean and Near Eastern Antiquities | Stockholm, Sweden | 19,559 |
| 3 | Museum of Far Eastern Antiquities | Stockholm, Sweden | 16,389 |
| 4 | Museum of World Culture | Göteborg, Sweden | 7,984 |
| 5 | Dresden State Art Collections. Porcelain collection | Dresden, Germany | 7,918 |
| 6 | Chester Beatty | Dublin, Ireland | 827 |
| 7 | Museum of Gothenburg | Göteborg, Sweden | 710 |
| 8 | East Asian Collections in Slovenia | Ljubljana, Slovenia | 250 |
| 9 | Vänersborgs museum | Vänersborg, Sweden | 206 |
| 10 | Sörmland Museum | Nyköping, Sweden | 140 |
| 11 | Army Museum | Stockholm, Sweden | 91 |
| 12 | Manos & Anastasia Faltaits Folk Art & Ethnographic Museum | Skýros, Greece | 77 |
| 13 | Skansen | Stockholm, Sweden | 53 |
| 14 | National Museum of Art of Romania | Bucharest, Romania | 38 |
| 15 | Peleș National Museum | Sinaia, Romania | 32 |
| 16 | Lusto - The Finnish Forest Museum | Kerimäki, Finland | 31 |
| 17 | Museum for Sepulchral Culture | Kassel, Germany | 24 |
| 18 | Asia and Pacific Museum | Warszawa, Poland | 22 |
| 19 | Amsterdam Museum | Amsterdam, Netherlands | 20 |
| 20 | Naval Museum | Karlskrona, Sweden | 18 |
| 21 | Riksidrottsmuseum | Stockholm, Sweden | 16 |
| 22 | Skelleftea museum | Skellefteå, Sweden | 14 |
| 23 | ASTRA National Museum Complex | Sibiu, Romania | 12 |
| 24 | National Museum of Lithuania | Vilnius, Lithuania | 12 |
| 25 | GoTellGo Cultural Association | Roma, Italy | 8 |
| 26 | Ploiești Museum of History and Archeology | Ploiești, Romania | 7 |
| 27 | Blekinge Museum | Karlskrona, Sweden | 6 |
| 28 | Museum of Arts and Crafts, Zagreb | Zagreb, Croatia | 5 |
| 29 | Iron Gates Region Museum | Drobeta-Turnu Severin, Romania | 5 |
| 30 | Trakai History Museum | Trakai, Lithuania | 5 |
| 31 | Norrbottens Museum | Lulea, Sweden | 4 |
| 32 | Vytautas the Great War Museum | Kaunas, Lithuania | 4 |
| 33 | Constanța Folk Art Museum | Constanța, Romania | 4 |
| 34 | Swedish Railway Museum | Gävle, Sweden | 4 |
| 35 | OTE Museum of Telecommunications | Athens, Greece | 4 |
| 36 | National Maritime Museum | Stockholm, Sweden | 3 |
| 37 | National Museum of Romanian History | Bucharest, Romania | 3 |
| 38 | Brașov County History Museum | Brașov, Romania | 3 |
| 39 | Hochschule Luzern – Design Film Kunst | Emmen, Switzerland | 2 |
| 40 | Malmö Museum | Malmö, Sweden | 2 |
| 41 | National Museum of Transylvanian History | Cluj-Napoca, Romania | 2 |
| 42 | Hälsinglands Museum | Hudiksvall, Sweden | 2 |
| 43 | Paul Păltănea Galați History Museum | Galați, Romania | 2 |
| 44 | German Clock Museum | Furtwangen, Germany | 2 |
| 45 | George Enescu National Museum | Bucharest, Romania | 1 |
| 46 | Teohari Antonescu Giurgiu County Museum | Giurgiu, Romania | 1 |
| 47 | Kulturparken Småland | Vaxjo, Sweden | 1 |
| 48 | Brukenthal National Museum | Sibiu, Romania | 1 |
| 49 | Jönköping County Museum | Jönköping, Sweden | 1 |
| 50 | National Museum of Banat | Timișoara, Romania | 1 |
| 51 | Székely National Museum | Sfântu Gheorghe, Romania | 1 |

Not included for now:

- **National Museum of Antiquities, Leiden** (27,020 objects): the origin comes only from Europeana's
  automatic place tagging, not from the museum's own records; a tagged place is often one depicted or
  mentioned. To be added once checked against the museum's own data.
- **National Museum of World Cultures (Wereldmuseum)** (3,295 objects): its image server moved and could
  not be checked yet.
- Objects whose image does not load, institutions without a location in Europeana's organisation
  records, and records whose origin spans several countries or is an ambiguous place name
  (`etl/europeana_flagged.json`, for review).

---

## Planned — Tier 1 (Open REST API)

Easy to integrate. API key required where noted.

| # | Institution | Location | Est. Artifacts | Access | Notes |
|---|-------------|----------|-------------|--------|-------|
| 9 | Smithsonian NMNH | Washington | ~500k filtered | REST API, key needed | Single key covers 19 Smithsonian museums |
| 10 | Smithsonian NMAI | Washington | ~800k | Same API | Native American collections |
| 11 | Smithsonian Freer/Sackler | Washington | ~40k | Same API | Asian + Islamic art |
| 14 | Cleveland Museum of Art | Cleveland | ~30k filtered | REST API (CC0) | — |
| 15 | Harvard Art Museums | Cambridge | ~250k filtered | REST API, key needed | — |
| 16 | Cooper Hewitt | New York | ~50k | REST API (CC0) | — |

---

## Planned — Tier 2 (SPARQL / Linked Open Data)

| # | Institution | Location | Est. Artifacts | Access | Notes |
|---|-------------|----------|-------------|--------|-------|
| 17 | British Museum | London | ~100k filtered | SPARQL | Endpoint unreliable — scraper in progress |
| 19 | Wikidata | Global | Millions | SPARQL | Query by museum Q-identifier |
| 20 | Deutsche Digitale Bibliothek | Germany | Large | OAI-PMH + API | German institutions not covered by SMB |

---

## Planned — Tier 3 (Scraper required)

No public API. Requires Playwright or requests-based scraper.

| # | Institution | Location | Est. Artifacts | Priority | Notes |
|---|-------------|----------|-------------|----------|-------|
| 21 | Musée du quai Branly | Paris | ~300k | 🔴 High | Africa, Americas, Asia, Oceania — most politically relevant after Ethnologisches |
| 22 | RMCA Tervuren | Belgium | ~180k | 🔴 High | Central Africa focus |
| 23 | Weltmuseum Wien | Vienna | ~200k | 🔴 High | Dense non-European scope |
| 24 | Tropenmuseum Amsterdam | Amsterdam | ~100k | 🔴 High | Colonial collection |
| 25 | Museum am Rothenbaum Hamburg | Hamburg | ~320k | 🟡 Medium | MARKK, non-European |
| 26 | Pitt Rivers Oxford | Oxford | ~30k | 🟡 Medium | Anthropological, dense provenance data |
| 27 | Penn Museum Philadelphia | Philadelphia | ~1M | 🟡 Medium | Africa, Near East, Asia |
| 28 | Peabody Museum Harvard | Cambridge | ~500k | 🟡 Medium | Archaeology + anthropology |
| 29 | Brooklyn Museum | New York | ~100k filtered | 🟡 Medium | African + Asian collections strong |
| 30 | LACMA | Los Angeles | ~150k filtered | 🟡 Medium | Asia + ancient Americas |
| 31 | Linden-Museum Stuttgart | Stuttgart | ~160k | 🟡 Medium | Non-European scope |
| 32 | Museum Fünf Kontinente Munich | Munich | ~160k | 🟡 Medium | Formerly Völkerkundemuseum |
| 33 | Rautenstrauch-Joest Köln | Cologne | ~65k | 🟡 Medium | Already part of IIP project |
| 34 | Übersee-Museum Bremen | Bremen | ~300k | 🟡 Medium | Non-European scope |
| 35 | Weltmuseum Frankfurt | Frankfurt | ~40k | 🟡 Medium | — |
| 36 | Peabody Essex Museum | Salem | ~35k | 🟢 Low | Maritime trade artifacts, Asia heavy |
| 37 | Denver Art Museum | Denver | ~25k | 🟢 Low | Native American focus |
| 38 | Musée de l'Homme | Paris | ~600k | 🟢 Low | Overlap with quai Branly |
| 39 | Musée Bargoin | Clermont-Ferrand | ~40k | 🟢 Low | Archaeological, underindexed |

---

## Planned — Tier 4 (Aggregators)

One integration covering many institutions.

| # | Platform | Coverage | Method | Notes |
|---|----------|----------|--------|-------|
| 40 | Smithsonian Open Access | 19 US museums | REST API | Single key — highest ROI integration |
| 42 | Museum Data Service (UK) | 100M+ UK artifacts | API | Covers Pitt Rivers, Horniman, and more |
| 43 | DPLA | US institutions | REST API | Digital Public Library of America |

---

## Scope

Ex Situ indexes artifacts that have been displaced from their origin territories — regardless of region or period. This includes artifacts from Africa, Asia, the Americas, Oceania, the Middle East, and the Mediterranean. The editorial filter is displacement, not geography.

Artifacts are indexed by origin site, not by cultural category. European museums' own classification systems (art, ethnographic, archaeological) are preserved in source labels but do not determine inclusion.

---

## Contributing a Resolver

If you want to add a collection not listed here, or accelerate a planned integration, see the [ETL README](etl/README.md).

Each institution needs a resolver — a Python script that fetches, normalizes, and geocodes collection data. The pattern is documented and existing resolvers serve as templates.

Open an issue before starting work to avoid duplication.

---

## Release History

| Version | Date | Collections | Artifacts |
|---------|------|-------------|---------|
| v0.1.0 | May 2026 | 8 | 111,497 |
| v1.1.0 | July 2026 | 9 | 200,552 |
| v1.2.0 | October 2026 | 61 | 227,872 on the map (265,166 indexed) |
| v1.3.0 | October 2026 | 61 | 280,763 on the map (318,828 indexed); Rijksmuseum indexed directly |

---

*Updated with each new collection release.*