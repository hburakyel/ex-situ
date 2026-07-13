"""
PostGIS-based Geocoder
======================
Fast local geocoding using PostGIS gazetteer tables.
No external API calls, no rate limits.

Usage:
    from postgis_geocoder import PostGISGeocoder

    geo = PostGISGeocoder()
    result = geo.geocode_place_details(["Istanbul", "Turkey"])
    print(result)
"""

from __future__ import annotations

import logging
import os
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional

import psycopg2
from psycopg2.extras import RealDictCursor

logger = logging.getLogger("postgis_geocoder")

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class GeocodingResult:
    """Structured geocoding result with audit metadata."""
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    geocoded_country: Optional[str] = None
    geocoded_region: Optional[str] = None
    geocoder_source: str = "postgis"
    geocoding_confidence: float = 0.0
    geocoding_status: str = "ok"          # ok | ambiguous | disputed | error
    geocoding_notes: Optional[str] = None
    review_status: str = "pending"        # pending | verified | manual

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Main PostGIS Geocoder
# ---------------------------------------------------------------------------

class PostGISGeocoder:
    """
    PostgreSQL/PostGIS-based geocoder using local gazetteer tables.
    
    Advantages over Nominatim:
    - No rate limits
    - Sub-millisecond query times
    - Full control over data and matching logic
    - Works offline
    
    Requirements:
    - PostgreSQL with PostGIS extension
    - Gazetteer tables populated (run import_gazetteer.sh)
    """
    
    # Disputed territory mappings (source mentions → flag as disputed)
    DISPUTED_KEYWORDS = {
        "palestine": ["israel", "palestinian territories"],
        "israel": ["palestine", "palestinian territories"],
        "taiwan": ["china"],
        "tibet": ["china"],
        "kashmir": ["india", "pakistan"],
        "crimea": ["ukraine", "russia"],
        "western sahara": ["morocco"],
    }
    
    def __init__(
        self,
        host: str = None,
        port: int = None,
        dbname: str = None,
        user: str = None,
        password: str = None,
    ):
        """
        Initialize connection to PostGIS database.
        
        Connection params can be passed directly or via environment variables:
        DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USERNAME, DATABASE_PASSWORD
        """
        self._conn_params = {
            "host": host or os.environ.get("DATABASE_HOST", "localhost"),
            "port": port or int(os.environ.get("DATABASE_PORT", 5432)),
            "dbname": dbname or os.environ.get("DATABASE_NAME", "museum_db"),
            "user": user or os.environ.get("DATABASE_USERNAME", "museum_user"),
            "password": password or os.environ.get("DATABASE_PASSWORD", ""),
        }
        self._conn: Optional[psycopg2.extensions.connection] = None
        self._stats = {"queries": 0, "hits": 0, "misses": 0}
    
    # -- Connection management ---------------------------------------------
    
    def _get_connection(self) -> psycopg2.extensions.connection:
        """Get or create database connection."""
        if self._conn is None or self._conn.closed:
            self._conn = psycopg2.connect(**self._conn_params)
        return self._conn
    
    def close(self) -> None:
        """Close database connection."""
        if self._conn and not self._conn.closed:
            self._conn.close()
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
    
    # -- Single place geocoding --------------------------------------------
    
    def geocode_single(self, place: str, country_hint: str = None) -> Optional[Dict[str, Any]]:
        """
        Geocode a single place name.
        
        Args:
            place: Place name to geocode
            country_hint: Optional country code or name to narrow results
        
        Returns:
            Dict with latitude, longitude, country_name, region_name, confidence, match_type
            or None if no match found
        """
        if not place or not place.strip():
            return None
        
        self._stats["queries"] += 1
        
        conn = self._get_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT 
                    latitude, longitude, country_name, region_name, 
                    confidence, match_type, name_en
                FROM geocode_place(%s, %s, 5)
                ORDER BY confidence DESC
                LIMIT 1
            """, (place.strip(), country_hint))
            
            row = cur.fetchone()
            
            if row:
                self._stats["hits"] += 1
                return dict(row)
            else:
                self._stats["misses"] += 1
                return None
    
    # -- Multi-part geocoding (main API) -----------------------------------
    
    def geocode_place_details(self, place_names: List[str]) -> GeocodingResult:
        """
        Geocode from a list of place name parts (e.g., ["city", "region", "country"]).
        
        Tries each part and returns the best match.
        Handles disputed territories and ambiguous results.
        
        Args:
            place_names: List of place name parts to try
        
        Returns:
            GeocodingResult with coordinates and metadata
        """
        result = GeocodingResult()
        
        if not place_names:
            return result
        
        # Check for disputed territory keywords
        disputed_flag = self._check_disputed(place_names)
        
        # Find country hint from place parts
        country_hint = self._extract_country_hint(place_names)
        
        # Try each place part
        candidates: List[Dict[str, Any]] = []
        
        for place in place_names:
            if not place or len(place.strip()) < 2:
                continue
            
            match = self.geocode_single(place, country_hint)
            if match:
                candidates.append({
                    "latitude": match["latitude"],
                    "longitude": match["longitude"],
                    "country_name": match["country_name"],
                    "region_name": match["region_name"],
                    "confidence": match["confidence"] or 0.5,
                    "match_type": match["match_type"],
                    "matched_query": place,
                })
        
        if not candidates:
            result.geocoding_status = "ambiguous"
            result.geocoding_notes = "No geocoding result"
            return result
        
        # Pick best candidate
        best = max(candidates, key=lambda c: c["confidence"])
        
        result.latitude = best["latitude"]
        result.longitude = best["longitude"]
        result.geocoded_country = best["country_name"]
        result.geocoded_region = best["region_name"]
        result.geocoding_confidence = best["confidence"]
        result.geocoding_notes = f"{best['matched_query']} ({best['match_type']})"
        
        # Set status based on confidence and disputed flag
        if best["confidence"] < 0.5:
            result.geocoding_status = "ambiguous"
        elif disputed_flag:
            result.geocoding_status = "disputed"
        else:
            result.geocoding_status = "ok"
        
        # Auto-verify high confidence, non-disputed results
        if result.geocoding_status == "ok" and best["confidence"] >= 0.85:
            result.review_status = "verified"
        
        return result
    
    # -- Reverse geocoding -------------------------------------------------
    
    def reverse_geocode(self, lat: float, lon: float) -> Dict[str, Any]:
        """
        Reverse geocode coordinates to place info.
        
        Args:
            lat: Latitude
            lon: Longitude
        
        Returns:
            Dict with country_name, country_code, region_name, city_name
        """
        conn = self._get_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT country_name, country_code, region_name, city_name, distance_km
                FROM reverse_geocode(%s, %s)
            """, (lat, lon))
            
            row = cur.fetchone()
            return dict(row) if row else {}
    
    # -- Helpers -----------------------------------------------------------
    
    def _check_disputed(self, place_names: List[str]) -> bool:
        """Check if any place name suggests a disputed territory."""
        text = " ".join(p.lower() for p in place_names if p)
        for keyword in self.DISPUTED_KEYWORDS:
            if keyword in text:
                return True
        return False
    
    def _extract_country_hint(self, place_names: List[str]) -> Optional[str]:
        """Try to identify a country from place parts for better matching."""
        conn = self._get_connection()
        
        for place in place_names:
            if not place:
                continue
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT country_code FROM gazetteer_places 
                    WHERE place_type = 'country' 
                    AND (lower(name) = lower(%s) OR lower(name_en) = lower(%s))
                    LIMIT 1
                """, (place.strip(), place.strip()))
                row = cur.fetchone()
                if row:
                    return row[0]
        return None
    
    # -- Stats -------------------------------------------------------------
    
    @property
    def stats(self) -> Dict[str, int]:
        """Return query statistics."""
        return dict(self._stats)
    
    def summary(self) -> Dict[str, Any]:
        """Log and return summary statistics."""
        total = self._stats["queries"]
        hit_rate = (self._stats["hits"] / total * 100) if total else 0
        logger.info(
            "PostGIS Geocoder: %d queries, %.1f%% hit rate",
            total, hit_rate
        )
        return self.stats


# ---------------------------------------------------------------------------
# Convenience functions
# ---------------------------------------------------------------------------

def geocode(place: str, **conn_kwargs) -> Optional[GeocodingResult]:
    """
    Quick geocode a single place name.
    
    Usage:
        result = geocode("Istanbul")
        print(result.latitude, result.longitude)
    """
    with PostGISGeocoder(**conn_kwargs) as geo:
        return geo.geocode_place_details([place])


def reverse_geocode(lat: float, lon: float, **conn_kwargs) -> Dict[str, Any]:
    """
    Quick reverse geocode coordinates.
    
    Usage:
        info = reverse_geocode(41.0082, 28.9784)
        print(info["country_name"])  # Turkey
    """
    with PostGISGeocoder(**conn_kwargs) as geo:
        return geo.reverse_geocode(lat, lon)


# ---------------------------------------------------------------------------
# CLI for testing
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    
    logging.basicConfig(level=logging.INFO)
    
    if len(sys.argv) < 2:
        print("Usage: python postgis_geocoder.py <place_name>")
        print("       python postgis_geocoder.py --reverse <lat> <lon>")
        sys.exit(1)
    
    with PostGISGeocoder() as geo:
        if sys.argv[1] == "--reverse" and len(sys.argv) >= 4:
            lat, lon = float(sys.argv[2]), float(sys.argv[3])
            result = geo.reverse_geocode(lat, lon)
            print(f"Reverse geocode ({lat}, {lon}):")
            for k, v in result.items():
                print(f"  {k}: {v}")
        else:
            place = " ".join(sys.argv[1:])
            result = geo.geocode_place_details([place])
            print(f"Geocode '{place}':")
            for k, v in result.to_dict().items():
                print(f"  {k}: {v}")
