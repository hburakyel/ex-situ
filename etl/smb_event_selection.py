"""
smb_event_selection.py — Event-type-aware origin selection for SMB
(museum-digital) object_events[].

Background (see the provenance audit, 2026-07-25): the original scrapers
(scrape_smb.py, scrape_smb_am_api.py) took object_events[0] positionally,
with no regard for what kind of event it was. A "Hergestellt" (Created)
event's place can be the maker's broad activity region — e.g. object 63249
("Kanne zum Aufwärmen von Shôchû-Schnaps") stores place_name derived from an
event whose place is "Kyūshū" (a whole island), attributed to a named maker,
not a findspot. Meanwhile some objects' real findspot lives on a *later*
event ("Gefunden") that [0]-indexing skips entirely — e.g. Vorderasiatisches
Museum object 274299, whose "Hergestellt" event has place=null while its
"Gefunden" event carries the real Babylon coordinates.

This module picks the best available event for "origin" purposes and
reports what kind of claim it actually represents, so callers never have to
guess from a bare place_name string again.

Priority (highest first):
    1. Gefunden (event_type 2)  — an actual findspot. Always preferred when
       present and it has a non-placeholder place.
    2. Hergestellt (1) / Gemalt (9) — a production event. Best available
       proxy for "origin" when there's no findspot, but NOT a findspot —
       flagged via origin_is_findspot=False so callers can say so.

Deliberately excluded from ever populating "origin" place, even if they're
the only event present: Gesammelt/Collected (8), Aufgenommen/Recorded (10),
Gesungen/Sung (28), Besessen/Owned (42), and anything else unrecognized —
these describe something that happened to the object after it already
existed (or aren't about place at all), not where it came from. An object
whose only event is e.g. "Gesammelt" yields no origin rather than silently
mislabeling the collector's context as origin.

SMB also returns the literal pair (0, 0) instead of null for events with no
known coordinate (see the null-island fix, 2026-07-25) — treated as "no
coordinate" here too, independent of whether the place has a name.
"""

from __future__ import annotations

from typing import Any, Optional, TypedDict

# event_type -> (English label, is this a genuine findspot?)
EVENT_TYPE_INFO: dict[int, tuple[str, bool]] = {
    1: ("Created", False),
    2: ("Found", True),
    8: ("Collected", False),
    9: ("Painted", False),
    10: ("Recorded", False),
    28: ("Sung", False),
    42: ("Owned", False),
}

# Event types eligible to supply the object's "origin" place, in priority
# order. Everything else (Collected, Recorded, Sung, Owned, unrecognized
# types) is excluded on purpose — see module docstring.
ORIGIN_EVENT_PRIORITY: list[int] = [2, 1, 9]


class OriginSelection(TypedDict):
    place_name: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    event_type_id: Optional[int]
    event_type_en: Optional[str]
    is_findspot: Optional[bool]
    person_name: Optional[str]


def _person_name(event: dict[str, Any]) -> Optional[str]:
    people = event.get("people")
    if isinstance(people, dict):
        return people.get("displayname") or people.get("people_display_name") or None
    return None


def _has_real_place(place: Optional[dict[str, Any]]) -> bool:
    """A place entry counts only if it has a name AND a non-placeholder coordinate.

    Bare (0, 0) is SMB's placeholder for "no known coordinate," not a real
    point — see fix_coordinates.py's null-island cleanup. A place_name with
    no usable coordinate is still preferable to nothing (callers can store
    the label with null lat/lon), so this only gates whether we treat the
    coordinate as real, not whether we use the event at all.
    """
    if not place:
        return False
    return bool(place.get("place_name"))


def select_origin_event(object_events: list[dict[str, Any]]) -> OriginSelection:
    """Pick the best event in object_events[] to represent object origin.

    Walks ORIGIN_EVENT_PRIORITY in order; within each tier, prefers an event
    that has both a place name and a real (non 0,0) coordinate over one with
    only a name. Returns an empty selection (all None) if nothing in the
    priority list has any place at all.
    """
    empty: OriginSelection = {
        "place_name": None, "latitude": None, "longitude": None,
        "event_type_id": None, "event_type_en": None,
        "is_findspot": None, "person_name": None,
    }
    if not object_events:
        return empty

    by_type: dict[int, list[dict[str, Any]]] = {}
    for evt in object_events:
        et = evt.get("event_type")
        if et is None:
            continue
        by_type.setdefault(et, []).append(evt)

    # Pass 1: prefer a tier event that has a name AND a real coordinate.
    # Pass 2: fall back to a tier event that has at least a name.
    for require_coords in (True, False):
        for event_type_id in ORIGIN_EVENT_PRIORITY:
            for evt in by_type.get(event_type_id, []):
                place = evt.get("place") or {}
                if not _has_real_place(place):
                    continue
                lat = place.get("place_latitude")
                lon = place.get("place_longitude")
                has_real_coords = lat not in (None, 0) or lon not in (None, 0)
                # (0, 0) is the SMB placeholder — never treat as real, even
                # if only one of the two is literally 0.
                if lat == 0 and lon == 0:
                    has_real_coords = False
                if require_coords and not has_real_coords:
                    continue

                label, is_findspot = EVENT_TYPE_INFO.get(event_type_id, (None, False))
                return {
                    "place_name": place.get("place_name"),
                    "latitude": lat if has_real_coords else None,
                    "longitude": lon if has_real_coords else None,
                    "event_type_id": event_type_id,
                    "event_type_en": label,
                    "is_findspot": is_findspot,
                    "person_name": _person_name(evt),
                }

    return empty
