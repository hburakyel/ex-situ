# Methodology

Ex Situ is an index, not a hoster. Every artifact links back to its source institution — nothing is duplicated as an authority in itself.

## Geolocated hyperlinks

Arcs are hyperlinks with coordinates. Each one connects a place to an institution, routing back to the source record rather than replacing it.

## What "place" means

A place can mean where an object was found, or where its maker was based — museums don't always distinguish the two, and neither do we, yet. Where a source institution is ambiguous, we inherit that ambiguity rather than resolve it with a guess.

## Taxonomy

Ex Situ does not apply its own classification system on top of what institutions provide. Categories, hierarchies, and labels are the institution's own — we index relationships.

## What "ex situ" means

An artifact whose current holding institution differs from its documented origin, however it got there — purchase, gift, colonial-era acquisition, excavation and export, or otherwise. No claim is made about legality or intent.

## Scope

Limited to institutions with open, programmatic access to their collections — currently mostly western/euro-American museums. This is a data-availability constraint where displacement occurred or mattered most. A thin or absent connection usually means missing open data, not a small or absent history.

## Dates

Object dates come from source institutions, shown at whatever precision they provide — exact year, range, century, or unknown. Undated objects remain visible; date filters never hide them silently.

## Geocoding

Place names are resolved to coordinates through a lookup table of known variants and a gazetteer. Fuzzy string matching is off by default and only used when explicitly enabled, because it produced false matches (Lagos → Laos, Delphi → Delhi); ambiguous places are flagged rather than guessed. Historical or ambiguous place names sometimes resolve imprecisely — corrections happen as they're found, not systematically.

## Origin checks

Each origin is checked against its own source record and the GeoNames gazetteer (`etl/audit_data_quality.py`). Where the stored point contradicts the source — a record naming "Peru, North Coast" placed in Canada, "Gallipoli, Turkey" placed at Gallipoli in Italy — the point is removed and the record is flagged for review; the artifact stays in the index as unlocated rather than shown in the wrong place. Where the source names a country and the point lies in it, that country is recorded. Cultural areas that span several present-day countries ("Middle East", "Polynesia", "Ottoman Empire") are not given a point at all. Exceptions are checked by hand and listed in `etl/normalize_origin_points.py`.

## Country labels

Country names on the map follow one rule for every country: the usage of the United Nations and the International Court of Justice. The basemap's own labels come from OpenStreetMap and treat neighbouring countries differently by zoom level, so Ex Situ draws country labels itself, from Natural Earth v5.1.2 (public domain), in the basemap's style.

- UN member states and the observer State of Palestine (General Assembly resolution 67/19) are labelled as countries. Natural Earth labels Palestine and Western Sahara later than their neighbours; here they appear from the same zoom as Israel and Morocco, and stay in view where labels would overlap.
- Territories are labelled as UN bodies describe them: Western Sahara as one territory (a UN Non-Self-Governing Territory); the Chagos Archipelago under that name (ICJ advisory opinion, 2019; General Assembly resolution 73/295); no separate label for Northern Cyprus (Security Council resolution 541).
- Countries carry their common English names; where a country has asked to be called by its own name, that name is used: Côte d'Ivoire, Timor-Leste, Cabo Verde, Czechia, Falkland Islands (Malvinas) as the UN writes it.
- Other contested borders (Kashmir, Kosovo, Taiwan, Somaliland) follow Natural Earth. The basemap's border lines are OpenStreetMap's and are not redrawn.

Below the world view, the start of each arc is named as the source record gives it. Countries are not shaded by number of artifacts: records name a place, and present-day borders often differ from those of the time an object was made, so shading by country would suggest a continuity the records don't state. Origins that name a region ("Africa", "Middle East") or a place drawn inside another country (Guadeloupe) are matched to no country rather than to a larger area. The labels are rebuilt by `etl/build_country_labels.py`.

## Titles

Object titles aren't shown. Historical museum records sometimes carry outdated or offensive language. The source link takes you directly to the institution's own record, including their title, if you want it.

## Dependent on open data

Source institutions update their own records continuously. Ex Situ reflects a snapshot at the time of indexing, not a live mirror — a museum's current record may already differ from what's shown here.

## Reporting issues

Found something wrong or outdated? Use "Report a data issue" from the export menu, or open an issue on [GitHub](https://github.com/hburakyel/ex-situ).