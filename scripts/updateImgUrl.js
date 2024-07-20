const axios = require('axios');

const strapiBaseUrl = 'http://127.0.0.1:1337/api/museum-objects'; // Changed to 127.0.0.1
const API_TOKEN = '9e9be33423d0974bdc0b00a98b1d2a596d596dcc8d805befd157641cd975c09d735a8fc9db5a98632fadd1c28cfa7f97015b2a14285c948d82b55e20994db295a21588a61cbb0f11446d1b0a5cad481e3e91329ead22a07bfac35805589cf3ab60cac8eddea736f8e069969ab85c53b675dfd2c359b7ea2e1bedcfb199fdcea3'; // Replace with your actual token

async function fetchEntries(page = 1) {
  try {
    const response = await axios.get(`${strapiBaseUrl}?pagination[page]=${page}&pagination[pageSize]=100&publicationState=preview`, {
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

async function updateEntry(id, updatedAttributes) {
  try {
    await axios.put(`${strapiBaseUrl}/${id}`, {
      data: updatedAttributes
    }, {
      headers: {
        Authorization: `Bearer ${API_TOKEN}`
      }
    });
    console.log(`Updated entry with ID: ${id}`);
  } catch (error) {
    console.error(`Error updating entry with ID ${id}:`, error);
  }
}

async function updateImageUrl() {
  try {
    let page = 1;
    let totalPages = 1;
    const oldUrlPart = 'https://smb.museum-digital.de/data/smb/resources/images/data/smb/images/';
    const newUrlPart = 'https://asset.museum-digital.org//media/800/smb/images/';

    do {
      console.log(`Fetching entries (page ${page})...`);
      const data = await fetchEntries(page);

      if (data && data.data.length > 0) {
        for (const entry of data.data) {
          const { img_url } = entry.attributes;
          if (img_url && img_url.includes(oldUrlPart)) {
            const updatedUrl = img_url.replace(oldUrlPart, newUrlPart);
            console.log(`Updating entry ID: ${entry.id}, New Image URL: ${updatedUrl}`);
            await updateEntry(entry.id, { img_url: updatedUrl });
          }
        }
      } else {
        console.log('No more entries found.');
        break;
      }

      totalPages = data.meta.pagination.pageCount;
      page += 1;
    } while (page <= totalPages);

    console.log('Image URLs updated successfully.');
  } catch (error) {
    console.error('Error updating image URLs:', error);
  }
}

updateImageUrl();
