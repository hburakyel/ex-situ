# Methodology

## What Ex Situ is

Ex Situ began as *Mapping Artefact Migration*, a 2022 MA thesis (HfG Offenbach)
proposing a counter-design to how museums visualize their digital
archives. It has since grown into a live spatial index tracking the
geographic relationship between an artifact's documented origin and its
current holding institution.

It is an **index** — it does not host, duplicate, or claim
to represent the complete holdings of any institution.

## Why index, not hoster

Artifacts are represented as arcs functioning literally as
hyperlinks: connective, not possessive. Clicking an arc or an image routes
the user to the institution's own database. Duplicating that data here would
mean creating a shadow archive with its own implied authority — one that
could drift from, outlive, or misrepresent the source it copied from. Ex
Situ keeps responsibility for describing and updating an object with the
institution that holds it, not with this project.

## What the data represents

Every record comes from an institution's own open-access API or public
dataset. Ex Situ adds no original object data of its own — images remain
URLs pointing back to the source institution, and metadata is only lightly
normalized (place-name resolution, coordinate assignment) to make mapping
possible.

## What the data is not

**This is not a count of what any institution actually holds.** This was
true from the project's first version and remains true today: the database
only captures what an institution has digitized and made available through
its digital archive — it is dependent on, and limited by, each institution's
own digitization process, and is expanded over time as that process
continues.

A record appears here only if it is:

- Digitized
- Publicly accessible via an open API or dataset
- Successfully matched to a resolvable origin site

For nearly every institution and origin site indexed here, true historical
and current holdings are larger — often substantially — than what's shown.
A thin or absent connection on the map usually reflects missing open data,
not a small or absent history.

## Site-matching methodology

Provenance text is resolved to origin sites through, in order:

1. A hardcoded lookup table of known spelling and historical place-name
   variants
2. A stopword/descriptive-phrase filter
3. Fuzzy string matching (RapidFuzz `token_sort_ratio`), accepted at
   ≥88/100 similarity, as a last resort

Human correction of bad matches exists as a tool but is not yet used at
scale. A separate automated pass (known-coordinates lookup, bounding-box
sanity checks, re-geocoding) has corrected a portion of records, but this is
automated correction, not human review, and shouldn't be read as
equivalent.

## Scope

Currently limited to institutions with open, programmatic API access —
predominantly western/euro-American museums. This is a data-availability
constraint, not a curatorial judgment about where cultural displacement
occurred or mattered most. Expansion to other institutions or regions is
welcome wherever comparable open data exists.

## Theoretical background

This project's framing draws on Ariella Aïsha Azoulay's *Potential History:
Unlearning Imperialism* (2019), the Sarr/Savoy restitution report *The
Restitution of African Cultural Heritage* (2018), and the deliberate use of
"artefact" rather than "art," "object," or "antiquity," to avoid reinforcing
hierarchical categorization inherited from museum classification systems.

## Reporting issues

Found something wrong, outdated, or missing? Use "Report a data issue" from
the export menu on the site, or open an issue on
[GitHub](https://github.com/hburakyel/ex-situ).