const axios = require('axios');

const strapiBaseUrl = 'http://127.0.0.1:1337/api/museum-objects'; // Use 127.0.0.1 instead of localhost
const API_TOKEN = '9e9be33423d0974bdc0b00a98b1d2a596d596dcc8d805befd157641cd975c09d735a8fc9db5a98632fadd1c28cfa7f97015b2a14285c948d82b55e20994db295a21588a61cbb0f11446d1b0a5cad481e3e91329ead22a07bfac35805589cf3ab60cac8eddea736f8e069969ab85c53b675dfd2c359b7ea2e1bedcfb199fdcea3'; // Replace with your actual token

async function fetchEntries(page = 1) {
  try {
    const response = await axios.get(`${strapiBaseUrl}?pagination[page]=${page}&pagination[pageSize]=100`, {
      headers: {
        Authorization: `Bearer ${API_TOKEN}`
      }
    });

    return response.data;
  } catch (error) {
    console.error(`Error fetching entries on page ${page}:`, error);
    return null;
  }
}

async function updateEntry(id) {
  try {
    await axios.put(`${strapiBaseUrl}/${id}`, {
      data: {
        publishedAt: null
      }
    }, {
      headers: {
        Authorization: `Bearer ${API_TOKEN}`
      }
    });
    console.log(`Updated entry with ID: ${id} to draft`);
  } catch (error) {
    console.error(`Error updating entry with ID ${id}:`, error);
  }
}

async function markDraftIfImgUrlOrLatLonEmpty() {
  try {
    let page = 1;
    let totalPages = 1;

    do {
      console.log(`Fetching entries (page ${page})...`);
      const data = await fetchEntries(page);

      if (data && data.data.length > 0) {
        for (const entry of data.data) {
          const { img_url, latitude, longitude } = entry.attributes;
          if (!img_url || img_url.trim() === '' || latitude === null || latitude === 0 || latitude === '' || longitude === null || longitude === 0 || longitude === '') {
            await updateEntry(entry.id);
          }
        }
      } else {
        console.log('No more entries found.');
        break;
      }

      totalPages = data.meta.pagination.pageCount;
      page += 1;
    } while (page <= totalPages);

    console.log('Completed updating entries to draft where img_url is empty, or lat/lon is null, 0, or empty.');
  } catch (error) {
    console.error('Error updating entries:', error);
  }
}

markDraftIfImgUrlOrLatLonEmpty();
