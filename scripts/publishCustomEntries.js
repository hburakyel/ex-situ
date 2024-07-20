const axios = require('axios');

const strapiBaseUrl = 'http://127.0.0.1:1337/api/museum-objects'; // Explicitly use IPv4 address
const API_TOKEN = '9e9be33423d0974bdc0b00a98b1d2a596d596dcc8d805befd157641cd975c09d735a8fc9db5a98632fadd1c28cfa7f97015b2a14285c948d82b55e20994db295a21588a61cbb0f11446d1b0a5cad481e3e91329ead22a07bfac35805589cf3ab60cac8eddea736f8e069969ab85c53b675dfd2c359b7ea2e1bedcfb199fdcea3'; // Replace with your actual token

async function fetchEntries(page = 1) {
  try {
    const response = await axios.get(`${strapiBaseUrl}?pagination[page]=${page}&pagination[pageSize]=100&publicationState=preview`, {
      headers: {
        Authorization: `Bearer ${API_TOKEN}`
      }
    });

    console.log(`Fetched ${response.data.data.length} entries on page ${page}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching entries on page ${page}:`, error.response ? error.response.data : error.message);
    return null;
  }
}

async function publishEntry(id) {
  try {
    await axios.put(`${strapiBaseUrl}/${id}`, {
      data: {
        publishedAt: new Date().toISOString()
      }
    }, {
      headers: {
        Authorization: `Bearer ${API_TOKEN}`
      }
    });
    console.log(`Published entry with ID: ${id}`);
  } catch (error) {
    console.error(`Error publishing entry with ID ${id}:`, error.response ? error.response.data : error.message);
  }
}

async function publishSpecificEntries() {
  let page = 1;
  let totalPages = 1;
  let publishedCount = 0;
  let errorCount = 0;

  try {
    do {
      console.log(`Fetching entries (page ${page})...`);
      const data = await fetchEntries(page);

      if (data && data.data.length > 0) {
        for (const entry of data.data) {
          const { institution_name, publishedAt } = entry.attributes;

          // Check if the institution_name matches and the entry is not already published
          if (institution_name === 'Museum für Islamische Kunst' && !publishedAt) {
            try {
              await publishEntry(entry.id);
              publishedCount++;
            } catch (error) {
              errorCount++;
            }
          } else {
            console.log(`Entry with ID: ${entry.id} does not match the criteria or is already published.`);
          }
        }
      } else {
        console.log('No more entries found.');
        break;
      }

      totalPages = data.meta.pagination.pageCount;
      page += 1;

      console.log(`Progress: Published ${publishedCount} entries, ${errorCount} errors`);

    } while (page <= totalPages);

    console.log(`All matching entries published successfully. Total published: ${publishedCount}, Total errors: ${errorCount}`);
  } catch (error) {
    console.error('Error publishing entries:', error.response ? error.response.data : error.message);
  }
}

publishSpecificEntries();
