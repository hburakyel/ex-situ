require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');
const fs = require('fs');

// Load your updated JSON file
const updatedData = JSON.parse(fs.readFileSync('updated_image_smb_antikensammlung_objects.json', 'utf-8'));

const strapiBaseUrl = process.env.STRAPI_BASE_URL || 'http://127.0.0.1:1337/api/museum-objects';
const API_TOKEN = process.env.API_TOKEN;
if (!API_TOKEN) { console.error('Missing API_TOKEN in .env'); process.exit(1); }

async function fetchEntries(page = 1) {
  try {
    const response = await axios.get(`${strapiBaseUrl}?pagination[page]=${page}&pagination[pageSize]=100`, {
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

async function updateEntry(id, updatedImgUrl) {
  try {
    await axios.put(`${strapiBaseUrl}/${id}`, {
      data: {
        img_url: updatedImgUrl
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
          // Find the updated data for this entry using inventory_number
          const updatedEntry = updatedData.find(item => item.inventory_number === entry.attributes.inventory_number);
          if (updatedEntry) {
            console.log(`Updating entry ID: ${entry.id} with new img_url: ${updatedEntry.img_url}`);
            await updateEntry(entry.id, updatedEntry.img_url);
          } else {
            console.log(`No matching updated data found for entry ID: ${entry.id}`);
          }
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
