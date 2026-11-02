"""
region_points.py — One point per region that spans several present-day countries
(METHODOLOGY.md, "Origins"), shared by every collection that names it.

A record that names only a region ("Middle East", "Polynesien", "Caucasus") is drawn at
the region's point from GeoNames or Wikidata, labelled with the region's English name and
matched to no country. Where the source point lies on a city (Wikidata's East Africa is
Nairobi, its Korean Peninsula Seoul, its Tibet Lhasa) or off the region (its Polynesia
lies off Australia), GeoNames' region feature is used instead.

Not given a point: continents, empires and other historical states, and records that name
two places ("Egypt or Syria") — a point would name a place the record does not.

Used by normalize_origin_points.py (the "region" pass) and by the scripts that unlocate
cultural areas (normalize_present_day_names.py, normalize_aic_origins.py), which leave
these regions alone.
"""

from audit_places import key

# English label → (lat, lon, source, country_en). The country is set only for a region
# inside one country.
REGIONS = {
    "Middle East": (28.0, 45.0, "Wikidata Q7204", None),
    # Wikidata's Near East point (Q48214) lies in the Sea of Galilee; the terms overlap.
    "Near East": (28.0, 45.0, "Wikidata Q7204 (Middle East)", None),
    "Levant": (34.0, 36.0, "GeoNames 305104", None),
    "Eastern Mediterranean": (34.0, 36.0, "Wikidata Q81483 (Levant)", None),
    "Mediterranean": (35.0, 18.0, "Wikidata Q72499 (Mediterranean Basin)", None),
    "West Asia": (29.166667, 47.6, "Wikidata Q27293", None),
    "Arabian Peninsula": (23.0, 46.0, "Wikidata Q31945", None),
    "Caucasus": (42.75, 44.5, "Wikidata Q18869", None),
    "Balkans": (42.0, 22.0, "Wikidata Q23522", None),
    "Northern Europe": (57.0, 14.0, "Wikidata Q27479", None),
    "Central Asia": (45.3, 63.9, "Wikidata Q27275", None),
    "Turkestan": (39.365733, 67.955584, "Wikidata Q1315785", None),
    "South Asia": (26.9, 72.2, "Wikidata Q771405", None),
    "Southeast Asia": (12.0, 105.1, "Wikidata Q11708", None),
    "East Asia": (47.210278, 102.847778, "Wikidata Q27231", None),
    "Korea": (38.62545, 127.55127, "GeoNames 11494804 (Korean Peninsula)", None),
    # As the Tibet and Kashmir rows already on the map are filed (one site each).
    "Tibet": (29.8556443, 90.8749807, "the point of the Tibet rows on the map", "China"),
    "Kashmir": (34.5, 76.0, "Wikidata Q43100, as the Kashmir rows on the map", "India"),
    "Himalayas": (28.0, 84.0, "GeoNames 1252558", None),
    "Sub-Saharan Africa": (-10.0, 23.0, "Wikidata Q132959", None),
    "West Africa": (12.0, 3.0, "Wikidata Q4412", None),
    "East Africa": (-0.52734, 36.51855, "GeoNames 7729889 (Eastern Africa)", None),
    "Central Africa": (2.0, 21.0, "Wikidata Q27433", None),
    "North Africa": (30.440742, 9.681714, "Wikidata Q27381", None),
    "Southern Africa": (-25.879106, 23.097578, "Wikidata Q27394", None),
    "Maghreb": (30.0, 5.0, "Wikidata Q28227", None),
    "Sahara": (23.079722, 12.612222, "Wikidata Q6583", None),
    "Ruvuma River": (-10.47472, 40.43833, "GeoNames 1027917", None),
    "Red Sea": (22.0, 38.0, "Wikidata Q23406", None),
    "Indian Ocean": (-20.0, 80.0, "Wikidata Q1239", None),
    "Central America": (12.0, -86.0, "Wikidata Q27611", None),
    "Mesoamerica": (16.0, -93.0, "Wikidata Q13703", None),
    "Caribbean": (15.0, -73.0, "Wikidata Q664609", None),
    "Antilles": (18.2176, -67.8639, "Wikidata Q166131", None),
    "Andes": (-21.826, -66.698, "Wikidata Q5456", None),
    "Tierra del Fuego": (-54.0, -70.0, "Wikidata Q82601", None),
    "Polynesia": (-17.6859, -143.87695, "GeoNames 7729901", None),
    "Melanesia": (-7.44962, 157.71973, "GeoNames 7729899", None),
    "Micronesia": (12.0, 152.0, "Wikidata Q3359409", None),
    "Caroline Islands": (7.23579, 147.77573, "GeoNames 11185873", None),
    "Torres Strait": (-9.833333, 142.5, "Wikidata Q179188", None),
    "Diomede Islands": (65.76687, -168.99445, "Wikidata Q204403", None),
    "Calchaquí Valleys": (-26.448539, -65.976446, "Wikidata Q525820", "Argentina"),
}

# Other names in the records (German, variants) → English label.
ALIASES = {
    "mittlerer orient": "Middle East",
    "vorderer orient": "Near East",
    "levante": "Levant",
    "mediterranean region": "Mediterranean",
    "ancient mediterranean": "Mediterranean",
    "eastern mediterranean region": "Eastern Mediterranean",
    "western asia": "West Asia",
    "westasien": "West Asia",
    "westasien unbestimmt": "West Asia",
    "kaukasus": "Caucasus",
    "balkan peninsula": "Balkans",
    "nordeuropa": "Northern Europe",
    "zentralasien": "Central Asia",
    "west-turkestan": "Turkestan",
    "sudasien": "South Asia",
    "sudostasien": "Southeast Asia",
    "ostasien": "East Asia",
    "himalaya": "Himalayas",
    "afrika sudlich der sahara": "Sub-Saharan Africa",
    "west-afrika": "West Africa",
    "western africa": "West Africa",
    "ost-afrika": "East Africa",
    "zentral-afrika": "Central Africa",
    "nordafrika": "North Africa",
    "nordafrika unbestimmt": "North Africa",
    "sud-afrika": "Southern Africa",
    "rovuma": "Ruvuma River",
    "rotes meer": "Red Sea",
    "indischer ozean": "Indian Ocean",
    "mittelamerika": "Central America",
    "karibik": "Caribbean",
    "antillen": "Antilles",
    "andean region": "Andes",
    "andengebiet": "Andes",
    "feuerland": "Tierra del Fuego",
    "polynesien": "Polynesia",
    "melanesien": "Melanesia",
    "mikronesien": "Micronesia",
    "micronesia region": "Micronesia",
    "karolinen": "Caroline Islands",
    "australia or papua new guinea, torres strait": "Torres Strait",
    "diomedes-inseln": "Diomede Islands",
    "calchaquigebiet": "Calchaquí Valleys",
}
# Rows of these regions that a collection filed under one country move too: Korea before 1945
# lies in both present-day Koreas.
WHOLE = {"Korea"}

_BY_KEY = {key(name): name for name in REGIONS}
_BY_KEY.update(ALIASES)


def region_of(name):
    """(label, lat, lon, source, country) for a region name, else None. An uncertain
    attribution keeps its mark: "Tibet (?)" → "Tibet?"."""
    if not name:
        return None
    text, hedged = name.strip(), False
    for mark in ("(?)", "?"):
        if text.endswith(mark):
            text, hedged = text[: -len(mark)].strip(), True
            break
    found = _BY_KEY.get(key(text))
    if not found:
        return None
    lat, lon, source, country = REGIONS[found]
    return (found + ("?" if hedged else ""), lat, lon, source, country)
