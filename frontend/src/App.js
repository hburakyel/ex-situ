import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import MapComponent from './components/Map';
import ObjectContainer from './components/ObjectContainer';
import Modal from './components/Modal';
import SearchBar from './components/SearchBar';
import Filter from './components/Filter';
import { fetchLocation } from './utils/fetchData';
import debounce from 'lodash.debounce';

function App() {
  const [geojson, setGeojson] = useState({ type: 'FeatureCollection', features: [] });
  const [objects, setObjects] = useState([]);
  const [modalContent, setModalContent] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentSize, setCurrentSize] = useState('small');
  const [bounds, setBounds] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isFetching, setIsFetching] = useState(false);
  const [filterVisible, setFilterVisible] = useState(false);
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

  const fetchObjectsWithinBounds = async (bounds, page = 1, reset = false) => {
    if (isFetching) return;
    setIsFetching(true);

    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    try {
      const response = await fetch(
        `http://127.0.0.1:1337/api/museum-objects?filters[latitude][$gte]=${sw.lat}&filters[latitude][$lte]=${ne.lat}&filters[longitude][$gte]=${sw.lng}&filters[longitude][$lte]=${ne.lng}&pagination[page]=${page}&pagination[pageSize]=60&populate=*`
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
            if (fromPlaces.has(placeName)) {
              fromPlaces.set(placeName, fromPlaces.get(placeName) + 1);
            } else {
              fromPlaces.set(placeName, 1);
            }
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
          objectCount: data.meta.pagination.total, // Use total count here
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
        const bounds = [
          [parseFloat(boundingbox[2]), parseFloat(boundingbox[0])],
          [parseFloat(boundingbox[3]), parseFloat(boundingbox[1])]
        ];
        mapRef.current.fitBounds(bounds, { padding: { top: 10, bottom: 25, left: 15, right: 5 } });
        setTimeout(() => {
          setBounds(bounds);
          setCurrentPage(1); // Reset to first page on new search
          setObjects([]); // Reset objects when bounds change
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
      console.log(`handleLocationClick - type: ${type}, location: ${location}, coordinatesList: ${coordinatesList}`);

      if (!coordinatesList) {
        console.error(`Invalid coordinates for from location: ${location}`);
        return;
      }

      const uniqueCoordinates = [...new Set(coordinatesList.map(JSON.stringify))].map(JSON.parse);

      if (uniqueCoordinates.length > 0) {
        const [lat, lng] = uniqueCoordinates[0];  // Take the first unique coordinates pair
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
    return 'Unknown Location';
  };

  return (
    <div className="App">
      <nav className="navbar">
        <div className="control-icons">
          <div className="icon" onClick={toggleContainerSize}><i className="fas fa-expand"></i></div>
          {/* Commented out filter toggle button */}
          {/* <div className="icon" onClick={toggleFilterVisibility}><i className="fas fa-filter"></i></div> */}
        </div>
        <div className="navbar-info">
          Ex-Situ {locationInfo.location} ({locationInfo.arcCount} Arcs / {locationInfo.objectCount} Artefacts)
        </div>
        <SearchBar onSearch={debouncedHandleSearch} />
      </nav>
      <ObjectContainer objects={objects} onScroll={handleScroll} currentSize={currentSize} onObjectClick={handleObjectClick} />
      {filterVisible && <Filter locationInfo={locationInfo} onZoom={handleLocationClick} />}
      <Modal isOpen={isModalOpen} onClose={handleCloseModal} content={modalContent} />
      <MapComponent 
        mapRef={mapRef} 
        setBounds={setBounds} 
        setLocationInfo={setLocationInfo} 
      />
    </div>
  );
}

export default App;
