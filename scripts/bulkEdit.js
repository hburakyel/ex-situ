const axios = require('axios');

const strapiBaseUrl = 'http://127.0.0.1:1337/api/museum-objects'; // Use 127.0.0.1 instead of localhost
const API_TOKEN = '9e9be33423d0974bdc0b00a98b1d2a596d596dcc8d805befd157641cd975c09d735a8fc9db5a98632fadd1c28cfa7f97015b2a14285c948d82b55e20994db295a21588a61cbb0f11446d1b0a5cad481e3e91329ead22a07bfac35805589cf3ab60cac8eddea736f8e069969ab85c53b675dfd2c359b7ea2e1bedcfb199fdcea3'; // Replace with your actual token

const targetPlaceName = 'Pergamon'; // Escaped single quote
const updatedLatitude = 39.116668701171875; // Replace with the actual latitude
const updatedLongitude = 27.183332443237305; // Replace with the actual longitude

async function fetchEntries(page = 1) {
  try {
    const response = await axios.get(`${strapiBaseUrl}?pagination[page]=${page}&pagination[pageSize]=100&filters[place_name][$eq]=${targetPlaceName}`, {
      headers: {
        Authorization: `Bearer ${API_TOKEN}`
      }
    });

    return response.data;
  } catch (error) {
    console.error(`Error fetching entries on page ${page}:`, error.message);
    return null;
  }
}

async function updateEntry(id, latitude, longitude) {
  try {
    await axios.put(`${strapiBaseUrl}/${id}`, {
      data: {
        latitude,
        longitude
      }
    }, {
      headers: {
        Authorization: `Bearer ${API_TOKEN}`
      }
    });
    console.log(`Updated entry with ID: ${id}`);
  } catch (error) {
    console.error(`Error updating entry with ID ${id}:`, error.message);
  }
}

async function updateAllEntries() {
  try {
    let page = 1;
    let totalPages = 1;

    do {
      console.log(`Fetching entries (page ${page})...`);
      const data = await fetchEntries(page);

      if (data && data.data.length > 0) {
        console.log(`Found ${data.data.length} entries to update on page ${page}`);
        for (const entry of data.data) {
          console.log(`Updating entry ID: ${entry.id}`);
          await updateEntry(entry.id, updatedLatitude, updatedLongitude);
        }
      } else {
        console.log('No more entries found.');
        break;
      }

      totalPages = data.meta.pagination.pageCount;
      page += 1;
    } while (page <= totalPages);

    console.log('All entries updated successfully.');
  } catch (error) {
    console.error('Error updating entries:', error.message);
  }
}

updateAllEntries();
