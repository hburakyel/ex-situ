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

Place names are resolved to coordinates through a lookup table of known variants, then fuzzy string matching as a last resort. Historical or ambiguous place names sometimes resolve imprecisely — corrections happen as they're found, not systematically.

## Titles

Object titles aren't shown. Historical museum records sometimes carry outdated or offensive language. The source link takes you directly to the institution's own record, including their title, if you want it.

## Dependent on open data

Source institutions update their own records continuously. Ex Situ reflects a snapshot at the time of indexing, not a live mirror — a museum's current record may already differ from what's shown here.

## Reporting issues

Found something wrong or outdated? Use "Report a data issue" from the export menu, or open an issue on [GitHub](https://github.com/hburakyel/ex-situ).