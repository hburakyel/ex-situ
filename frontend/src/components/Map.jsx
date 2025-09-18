import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import DeckGL from '@deck.gl/react';
import { ArcLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import './Map.css';

const strapiBaseUrl = 'http://5.75.159.196:1337/api/museum-objects';
const mapboxToken = 'pk.eyJ1IjoiaGJ1cmFreWVsIiwiYSI6ImNsN2FoZmU0MTAyY3ozbm83cGJ5M3NjbTEifQ.bWrhIGqeJ_JHh3Crwwp9tA';
mapboxgl.accessToken = mapboxToken;

const MapComponent = ({ setBounds, setLocationInfo, mapRef }) => {
  const mapContainerRef = useRef(null);
  const overlayRef = useRef(null);
  const [geojson, setGeojson] = useState({ type: 'FeatureCollection', features: [] });
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (mapContainerRef.current) {
      const mapInstance = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: 'mapbox://styles/mapbox/streets-v11',
        center: [0, 0],
        zoom: 2,
      });

      mapRef.current = mapInstance;

      const overlay = new MapboxOverlay({ layers: [] });
      overlayRef.current = overlay;
      mapInstance.addControl(overlay);

      mapInstance.on('load', () => {
        mapInstance.addSource('osm-tiles', {
          type: 'raster',
          tiles: [
            'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
            'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
            'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
        });

        mapInstance.addLayer({
          id: 'osm-tiles',
          type: 'raster',
          source: 'osm-tiles',
          minzoom: 0,
          maxzoom: 22,
        });

        mapInstance.on('moveend', () => {
          const bounds = mapInstance.getBounds();
          setBounds(bounds);
          fetchObjectsWithinBounds(bounds);
        });

        fetchAllObjectsForArcs();
      });

      return () => {
        overlay.setProps({ layers: [] });
        mapInstance.remove();
      };
    }
  }, [setBounds]);

  useEffect(() => {
    if (overlayRef.current) {
      overlayRef.current.setProps({
        layers: [
          new ArcLayer({
            id: 'arc-layer',
            data: geojson.features,
            getSourcePosition: d => d.properties.sourceCoordinates,
            getTargetPosition: d => d.properties.targetCoordinates,
            getSourceColor: [0, 128, 200],
            getTargetColor: [200, 0, 80],
            getWidth: 2,
            pickable: true,
            autoHighlight: true,
            onHover: ({ object, x, y }) => {
              if (object) {
                const placeName = object.properties.name;
                const objectCount = object.properties.count;
                showTooltip(x, y, `${placeName} (${objectCount})`);
              } else {
                hideTooltip();
              }
            },
            onClick: ({ object }) => {
              if (object) {
                const coordinates = object.properties.targetCoordinates;
                mapRef.current.flyTo({ center: coordinates, zoom: 10 });
              }
            },
          }),
        ],
      });
    }
  }, [geojson]);

  const fetchAllObjectsForArcs = async () => {
    setIsFetching(true);
    setError(null);

    try {
      const response = await fetch(`${strapiBaseUrl}?pagination[pageSize]=-1&populate=*`);
      if (!response.ok) {
        throw new Error(`Network response was not ok: ${response.statusText}`);
      }
      const data = await response.json();
      const allObjects = data.data;

      const features = allObjects.map((obj) => {
        const attributes = obj.attributes;
        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [parseFloat(attributes.longitude), parseFloat(attributes.latitude)],
          },
          properties: {
            id: obj.id,
            name: attributes.title,
            count: 1,
            sourceCoordinates: [parseFloat(attributes.institution_longitude), parseFloat(attributes.institution_latitude)],
            targetCoordinates: [parseFloat(attributes.longitude), parseFloat(attributes.latitude)],
            img_url: attributes.img_url,
            title: attributes.title,
          },
        };
      });

      setGeojson({ type: 'FeatureCollection', features });

      if (features.length > 0) {
        const randomFeature = features[Math.floor(Math.random() * features.length)];
        mapRef.current.flyTo({ center: randomFeature.geometry.coordinates, zoom: 10 });
      }
    } catch (error) {
      setError(error.message);
      console.error('Error fetching all objects for arcs:', error);
    } finally {
      setIsFetching(false);
    }
  };

  const fetchObjectsWithinBounds = async (bounds) => {
    if (isFetching) return;
    setIsFetching(true);
    setError(null);

    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    try {
      const response = await fetch(`${strapiBaseUrl}?filters[latitude][$gte]=${sw.lat}&filters[latitude][$lte]=${ne.lat}&filters[longitude][$gte]=${sw.lng}&filters[longitude][$lte]=${ne.lng}&pagination[page]=1&pagination[pageSize]=60&populate=*`);
      if (!response.ok) {
        throw new Error(`Network response was not ok: ${response.statusText}`);
      }
      const data = await response.json();
      const newObjects = data.data;

      const features = newObjects.map((obj) => {
        const attributes = obj.attributes;
        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [parseFloat(attributes.longitude), parseFloat(attributes.latitude)],
          },
          properties: {
            id: obj.id,
            name: attributes.title,
            count: 1,
            sourceCoordinates: [parseFloat(attributes.institution_longitude), parseFloat(attributes.institution_latitude)],
            targetCoordinates: [parseFloat(attributes.longitude), parseFloat(attributes.latitude)],
            img_url: attributes.img_url,
            title: attributes.title,
          },
        };
      });

      setGeojson(prevGeojson => ({
        ...prevGeojson,
        features: [...prevGeojson.features, ...features],
      }));

      const uniqueArcs = new Set(features.map(f => JSON.stringify([f.properties.sourceCoordinates, f.properties.targetCoordinates]))).size;

      let fromPlaces = new Map();
      let toPlaces = new Set();
      let institutionNames = new Set();
      let fromCoordinates = {};

      newObjects.forEach(obj => {
        const attributes = obj.attributes;
        const placeName = attributes.place_name;
        const latLng = [parseFloat(attributes.latitude), parseFloat(attributes.longitude)];
        if (placeName) {
          if (fromPlaces.has(placeName)) {
            fromPlaces.set(placeName, fromPlaces.get(placeName) + 1);
          } else {
            fromPlaces.set(placeName, 1);
          }

          if (!fromCoordinates[placeName]) {
            fromCoordinates[placeName] = [];
          }
          fromCoordinates[placeName].push(latLng);
        }
        toPlaces.add(attributes.institution_place);
        institutionNames.add(attributes.institution_name);
      });

      const center = mapRef.current.getCenter();
      const placeName = await getPlaceName(center.lat, center.lng);

      setLocationInfo({
        location: placeName,
        arcCount: uniqueArcs,
        objectCount: data.meta.pagination.total,
        fromPlaces: Array.from(fromPlaces.entries()).map(([place, count]) => `${place} (${count})`).join(', '),
        toPlaces: [...toPlaces].join(', '),
        institutionNames: [...institutionNames].join(', '),
        fromCoordinates,
      });

    } catch (error) {
      setError(error.message);
      console.error('Error fetching objects within bounds:', error);
    } finally {
      setIsFetching(false);
    }
  };

  async function getPlaceName(lat, lng) {
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=local`);
      if (!response.ok) {
        throw new Error(`Network response was not ok: ${response.statusText}`);
      }
      const data = await response.json();
      if (data && data.address) {
        return data.address.city || data.address.town || data.address.village || data.address.country || '';
      }
    } catch (error) {
      console.error('Error fetching place name:', error);
    }
    return '';
  }

  const showTooltip = (x, y, content) => {
    const tooltip = document.getElementById('tooltip');
    if (tooltip) {
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
      tooltip.innerHTML = content;
      tooltip.style.display = 'block';
    }
  };

  const hideTooltip = () => {
    const tooltip = document.getElementById('tooltip');
    if (tooltip) {
      tooltip.style.display = 'none';
    }
  };

  return (
    <div ref={mapContainerRef} className="map-container">
      <DeckGL
        initialViewState={{
          longitude: 0,
          latitude: 0,
          zoom: 2,
        }}
        controller={true}
        layers={[]}
      />
      {error && <div className="error-message">Error: {error}</div>}
      {isFetching && <div className="loading-message">Loading...</div>}
    </div>
  );
};

export default MapComponent;
