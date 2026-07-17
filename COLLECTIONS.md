# Ex Situ — Collection Roadmap

Current: **200,552 artifacts · 9 collections · 194 territories · 6,679 origin sites**

This document tracks indexed collections, planned integrations, and contribution priorities.

---

## Indexed Collections

| # | Institution | Location | Artifacts | Method | Status |
|---|-------------|----------|---------|--------|--------|
| 1 | Ethnologisches Museum | Berlin | 76,990 | SMB API | ✅ Live |
| 2 | Victoria and Albert Museum | London | 41,981 | REST API | ✅ Live |
| 3 | The Metropolitan Museum of Art | New York | 19,587 | REST API (CC0) | ✅ Live |
| 4 | Ägyptisches Museum und Papyrussammlung | Berlin | 6,328 | SMB API | ✅ Live |
| 5 | Museum für Islamische Kunst | Berlin | 12,409 | SMB API | ✅ Live |
| 6 | Antikensammlung | Berlin | 5,613 | SMB API | ✅ Live |
| 7 | Museum für Asiatische Kunst | Berlin | 2,693 | SMB API | ✅ Live |
| 8 | Vorderasiatisches Museum | Berlin | 1,061 | SMB API | ✅ Live |
| 9 | Art Institute of Chicago | Chicago | 33,890 | REST API (CC0) | ✅ Live |

---

## Planned — Tier 1 (Open REST API)

Easy to integrate. API key required where noted.

| # | Institution | Location | Est. Artifacts | Access | Notes |
|---|-------------|----------|-------------|--------|-------|
| 9 | Smithsonian NMNH | Washington | ~500k filtered | REST API, key needed | Single key covers 19 Smithsonian museums |
| 10 | Smithsonian NMAI | Washington | ~800k | Same API | Native American collections |
| 11 | Smithsonian Freer/Sackler | Washington | ~40k | Same API | Asian + Islamic art |
| 12 | Rijksmuseum | Amsterdam | ~15k filtered | REST API, key needed | Filter by non-European origin |
| 14 | Cleveland Museum of Art | Cleveland | ~30k filtered | REST API (CC0) | — |
| 15 | Harvard Art Museums | Cambridge | ~250k filtered | REST API, key needed | — |
| 16 | Cooper Hewitt | New York | ~50k | REST API (CC0) | — |

---

## Planned — Tier 2 (SPARQL / Linked Open Data)

| # | Institution | Location | Est. Artifacts | Access | Notes |
|---|-------------|----------|-------------|--------|-------|
| 17 | British Museum | London | ~100k filtered | SPARQL | Endpoint unreliable — scraper in progress |
| 18 | Europeana | Pan-European | Millions filtered | REST API, key needed | Aggregator — covers 3000+ institutions in one integration |
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
| 41 | Europeana | 3000+ European institutions | REST API | Filter non-European origin artifacts |
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

---

*Updated with each new collection release.*