// src/utils/fetchData.js
export const strapiBaseUrl = 'http://5.75.159.196:1337/api/museum-objects';

export const fetchObjectsWithinBounds = async (bounds, page = 1) => {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();

  try {
    const response = await fetch(
      `${strapiBaseUrl}?filters[latitude][$gte]=${sw.lat}&filters[latitude][$lte]=${ne.lat}&filters[longitude][$gte]=${sw.lng}&filters[longitude][$lte]=${ne.lng}&pagination[page]=${page}&pagination[pageSize]=60&populate=*`
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
          sourceCoordinates: [parseFloat(attributes.institution_longitude), parseFloat(attributes.institution_latitude)],
          targetCoordinates: [parseFloat(attributes.longitude), parseFloat(attributes.latitude)],
          name: attributes.title,
          count: 1,
        },
      };
    });

    return { objects: newObjects, features };
  } catch (error) {
    console.error('Error fetching objects:', error);
    throw error;
  }
};

export const fetchLocation = async (location) => {
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${location}&format=json&limit=1`);
    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching location:', error);
    throw error;
  }
};
