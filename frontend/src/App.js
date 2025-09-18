import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import MapComponent from './components/Map';
import ObjectContainer from './components/ObjectContainer';
import Modal from './components/Modal';
import Filter from './components/Filter';
import Info from './components/Info';
import { fetchLocation } from './utils/fetchData';
import debounce from 'lodash.debounce';
import mapboxgl from 'mapbox-gl';

function App() {
  const [geojson, setGeojson] = useState({ type: 'FeatureCollection', features: [] });
  const [objects, setObjects] = useState([]);
  const [modalContent, setModalContent] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentSize, setCurrentSize] = useState('large');
  const [bounds, setBounds] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isFetching, setIsFetching] = useState(false);
  const [filterVisible, setFilterVisible] = useState(false);
  const [infoVisible, setInfoVisible] = useState(false);
  const [locationInfo, setLocationInfo] = useState({
    location: '',
    arcCount: 0,
    objectCount: 0,
    fromPlaces: '',
    toPlaces: '',
    institutionNames: '',
    fromCoordinates: {}
  });
  const mapRef = useRef(null);

  const toggleInfoVisibility = () => {
    setInfoVisible(prevState => !prevState);
  };

  // fetchObjectsWithinBounds fonksiyonu
  const fetchObjectsWithinBounds = async (bounds, page = 1, reset = false) => {
    if (isFetching) return;
    setIsFetching(true);

    if (!bounds || typeof bounds.getSouthWest !== 'function' || typeof bounds.getNorthEast !== 'function') {
      console.error('Bounds object is not in the correct format');
      setIsFetching(false);
      return;
    }

    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    try {
      const response = await fetch(
        `http://5.75.159.196:1337/api/museum-objects?filters[latitude][$gte]=${sw.lat}&filters[latitude][$lte]=${ne.lat}&filters[longitude][$gte]=${sw.lng}&filters[longitude][$lte]=${ne.lng}&pagination[page]=${page}&pagination[pageSize]=30&populate=*`
      );
      if (!response.ok) {
        throw new Error(`Network response was not ok: ${response.statusText}`);
      }
      const data = await response.json();
      const newObjects = data.data;

      const features = newObjects.map(obj => {
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

      setObjects(reset ? newObjects : prevObjects => [...prevObjects, ...newObjects]);
      setGeojson(prevGeojson => ({
        ...prevGeojson,
        features: reset ? features : [...prevGeojson.features, ...features],
      }));

      if (reset) {
        const fromPlaces = new Map();
        const toPlaces = new Set();
        const institutionNames = new Set();

        newObjects.forEach(obj => {
          const attributes = obj.attributes;
          const placeName = attributes.place_name;
          if (placeName) {
            fromPlaces.set(placeName, (fromPlaces.get(placeName) || 0) + 1);
          }
          toPlaces.add(attributes.institution_place);
          institutionNames.add(attributes.institution_name);
        });

        const uniqueArcs = new Set(features.map(f => JSON.stringify([f.properties.sourceCoordinates, f.properties.targetCoordinates]))).size;
        const center = mapRef.current.getCenter();
        const placeName = await getPlaceName(center.lat, center.lng);

        setLocationInfo({
          location: placeName,
          arcCount: uniqueArcs,
          objectCount: data.meta.pagination.total,
          fromPlaces: Array.from(fromPlaces.entries()).map(([place, count]) => `${place} (${count})`).join(', '),
          toPlaces: [...toPlaces].join(', '),
          institutionNames: [...institutionNames].join(', '),
          fromCoordinates: Object.fromEntries(fromPlaces),
        });
      }

    } catch (error) {
      console.error('Error fetching objects within bounds:', error);
    } finally {
      setIsFetching(false);
    }
  };

  // fetchInitialData fonksiyonu
  const fetchInitialData = async () => {
    try {
      const response = await fetch('http://5.75.159.196:1337/api/museum-objects?pagination[page]=1&pagination[pageSize]=1');
      const data = await response.json();
      const objects = data.data;
      if (objects.length > 0) {
        const randomObject = objects[Math.floor(Math.random() * objects.length)];
        const attributes = randomObject.attributes;
        const initialCoordinates = [parseFloat(attributes.longitude), parseFloat(attributes.latitude)];
        mapRef.current = new mapboxgl.Map({
          container: 'map',
          style: 'mapbox://styles/mapbox/streets-v11',
          center: initialCoordinates,
          zoom: 10
        });
        mapRef.current.on('load', () => {
          setBounds(mapRef.current.getBounds());
        });
      } else {
        mapRef.current = new mapboxgl.Map({
          container: 'map',
          style: 'mapbox://styles/mapbox/streets-v11',
          center: [0, 0],
          zoom: 2
        });
      }
    } catch (error) {
      console.error('Error fetching initial data:', error);
    }
  };

  useEffect(() => {
    fetchInitialData();
  }, []);

  useEffect(() => {
    if (bounds) {
      fetchObjectsWithinBounds(bounds, 1, true);
    }
  }, [bounds]);

  const handleSearch = async (location) => {
    try {
      const data = await fetchLocation(location);
      if (data.length > 0) {
        const { lat, lon, boundingbox } = data[0];
        const bounds = new mapboxgl.LngLatBounds(
          [parseFloat(boundingbox[2]), parseFloat(boundingbox[0])],
          [parseFloat(boundingbox[3]), parseFloat(boundingbox[1])]
        );
        mapRef.current.fitBounds(bounds, { padding: { top: 10, bottom: 25, left: 15, right: 5 } });
        setTimeout(() => {
          setBounds(bounds);
          setCurrentPage(1);
          fetchObjectsWithinBounds(bounds, 1, true);
        }, 100);
      } else {
        alert('Location not found');
      }
    } catch (error) {
      console.error('Error fetching location:', error);
      alert('An error occurred while searching for the location');
    }
  };

  const debouncedHandleSearch = useCallback(debounce(handleSearch, 500), []);

  const handleOpenModal = (content) => {
    setModalContent(content);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setModalContent(null);
  };

  const handleScroll = () => {
    const objectContainer = document.getElementById('objectContainer');
    if (
      objectContainer.scrollTop + objectContainer.clientHeight >= objectContainer.scrollHeight - 10 && 
      !isFetching
    ) {
      setCurrentPage(prevPage => {
        fetchObjectsWithinBounds(bounds, prevPage + 1);
        return prevPage + 1;
      });
    }
  };

  const toggleContainerSize = () => {
    setCurrentSize(prevSize => prevSize === 'medium' ? 'large' : prevSize === 'large' ? 'small' : 'medium');
  };

  const toggleFilterVisibility = () => {
    setFilterVisible(prevState => !prevState);
  };

  const handleObjectClick = (object) => {
    if (object && object.attributes) {
      const {
        object_id,
        title,
        img_url,
        latitude,
        longitude,
        time,
        institution_place,
        institution_name,
        place_name,
        inventory_number,
        object_links
      } = object.attributes;

      const timeInfo = time && time.length > 0 ? `${time[0].time_name}, ${time[0].time_start}, ${time[0].time_end}` : 'N/A';
      const objectLinkData = object_links?.[0] || {};
      const objectLinkText = objectLinkData.link_text || 'N/A';
      const objectLinkUrl = objectLinkData.link_display || '';

      const modalData = {
        objectId: object_id,
        title,
        imgUrl: img_url,
        latitude,
        longitude,
        timeInfo,
        institutionPlace: institution_place,
        institutionName: institution_name,
        placeName: place_name,
        inventoryNumber: inventory_number,
        linkText: objectLinkText,
        linkUrl: objectLinkUrl
      };

      handleOpenModal(modalData);

      if (latitude && longitude) {
        const targetCoordinates = [parseFloat(longitude), parseFloat(latitude)];
        mapRef.current.flyTo({ center: targetCoordinates, zoom: 10 });
      }
    } else {
      console.error('Object attributes or coordinates are missing');
    }
  };

  const handleLocationClick = (type, location) => {
    if (type === 'from') {
      const coordinatesList = locationInfo.fromCoordinates[location];
  
      if (!Array.isArray(coordinatesList)) {
        console.error(`Invalid coordinates for from location: ${location}`);
        return;
      }
  
      const uniqueCoordinates = [...new Set(coordinatesList.map(JSON.stringify))].map(JSON.parse);
  
      if (uniqueCoordinates.length > 0) {
        const [lat, lng] = uniqueCoordinates[0];
        if (!isNaN(lat) && !isNaN(lng)) {
          mapRef.current.flyTo({ center: [lng, lat], zoom: 10 });
        } else {
          console.error(`Invalid coordinates for from location: ${location}`);
        }
      } else {
        console.error(`No valid coordinates found for from location: ${location}`);
      }
    } else if (type === 'to') {
      // Handle 'to' location if needed
    }
  };
  

  const getPlaceName = async (lat, lng) => {
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=local`);
      if (!response.ok) {
        throw new Error(`Network response was not ok: ${response.statusText}`);
      }
      const data = await response.json();
      if (data && data.address) {
        let placeName = '';
        if (data.address.city) {
          placeName = data.address.city;
        } else if (data.address.town) {
          placeName = data.address.town;
        } else if (data.address.village) {
          placeName = data.address.village;
        } else if (data.address.country) {
          placeName = data.address.country;
        }
        return placeName;
      }
    } catch (error) {
      console.error('Error fetching place name:', error);
    }
    return '';
  };

  return (
    <div className="App">
      <nav className="navbar">
        <div className="control-icons">
          <div className="icon" onClick={toggleFilterVisibility}><svg width="20" height="20" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 6.5C10 8.433 8.433 10 6.5 10C4.567 10 3 8.433 3 6.5C3 4.567 4.567 3 6.5 3C8.433 3 10 4.567 10 6.5ZM9.30884 10.0159C8.53901 10.6318 7.56251 11 6.5 11C4.01472 11 2 8.98528 2 6.5C2 4.01472 4.01472 2 6.5 2C8.98528 2 11 4.01472 11 6.5C11 7.56251 10.6318 8.53901 10.0159 9.30884L12.8536 12.1464C13.0488 12.3417 13.0488 12.6583 12.8536 12.8536C12.6583 13.0488 12.3417 13.0488 12.1464 12.8536L9.30884 10.0159Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"></path></svg></div>       
          <div className="icon" onClick={toggleContainerSize}><svg width="20" height="20" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.5 3.04999C11.7485 3.04999 11.95 3.25146 11.95 3.49999V7.49999C11.95 7.74852 11.7485 7.94999 11.5 7.94999C11.2515 7.94999 11.05 7.74852 11.05 7.49999V4.58639L4.58638 11.05H7.49999C7.74852 11.05 7.94999 11.2515 7.94999 11.5C7.94999 11.7485 7.74852 11.95 7.49999 11.95L3.49999 11.95C3.38064 11.95 3.26618 11.9026 3.18179 11.8182C3.0974 11.7338 3.04999 11.6193 3.04999 11.5L3.04999 7.49999C3.04999 7.25146 3.25146 7.04999 3.49999 7.04999C3.74852 7.04999 3.94999 7.25146 3.94999 7.49999L3.94999 10.4136L10.4136 3.94999L7.49999 3.94999C7.25146 3.94999 7.04999 3.74852 7.04999 3.49999C7.04999 3.25146 7.25146 3.04999 7.49999 3.04999L11.5 3.04999Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"></path></svg></div>
          <div className="icon" onClick={toggleInfoVisibility}><svg width="20" height="20" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.49991 0.876892C3.84222 0.876892 0.877075 3.84204 0.877075 7.49972C0.877075 11.1574 3.84222 14.1226 7.49991 14.1226C11.1576 14.1226 14.1227 11.1574 14.1227 7.49972C14.1227 3.84204 11.1576 0.876892 7.49991 0.876892ZM1.82707 7.49972C1.82707 4.36671 4.36689 1.82689 7.49991 1.82689C10.6329 1.82689 13.1727 4.36671 13.1727 7.49972C13.1727 10.6327 10.6329 13.1726 7.49991 13.1726C4.36689 13.1726 1.82707 10.6327 1.82707 7.49972ZM8.24992 4.49999C8.24992 4.9142 7.91413 5.24999 7.49992 5.24999C7.08571 5.24999 6.74992 4.9142 6.74992 4.49999C6.74992 4.08577 7.08571 3.74999 7.49992 3.74999C7.91413 3.74999 8.24992 4.08577 8.24992 4.49999ZM6.00003 5.99999H6.50003H7.50003C7.77618 5.99999 8.00003 6.22384 8.00003 6.49999V9.99999H8.50003H9.00003V11H8.50003H7.50003H6.50003H6.00003V9.99999H6.50003H7.00003V6.99999H6.50003H6.00003V5.99999Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"></path></svg></div> {/* New Info button */}
        </div>
        <div className="navbar-info">
  <span id="locationInfo">
    <div className="logo">Ex-Situ</div>
    <div className="location">
      {locationInfo.location ? locationInfo.location : ""}
    </div>
  </span>
  <div className="field-name">
    {locationInfo.objectCount || "Loading..."}
  </div>
</div>
      </nav>
      <ObjectContainer objects={objects} onScroll={handleScroll} currentSize={currentSize} onObjectClick={handleObjectClick} />
      {filterVisible && <Filter locationInfo={locationInfo} onZoom={handleLocationClick} filterVisible={filterVisible} onSearch={debouncedHandleSearch} />}
      <Modal isOpen={isModalOpen} onClose={handleCloseModal} content={modalContent} />
      <MapComponent 
        mapRef={mapRef} 
        setBounds={setBounds} 
        setLocationInfo={setLocationInfo} 
      />
      {infoVisible && <Info onClose={toggleInfoVisibility} />} {/* Conditionally render Info component with close handler */}
    </div>
  );
}

export default App;
