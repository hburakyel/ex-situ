require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');
const fs = require('fs');

// Load your updated JSON file
const updatedData = JSON.parse(fs.readFileSync('updated_image_smb_antikensammlung_objects.json', 'utf-8'));

const strapiBaseUrl = process.env.STRAPI_BASE_URL || 'http://127.0.0.1:1337/api/museum-objects';
const API_TOKEN = process.env.API_TOKEN;
if (!API_TOKEN) { console.error('Missing API_TOKEN in .env'); process.exit(1); }

// Function to fetch museum object by object_id
async function fetchMuseumObjectById(objectId) {
  try {
    const response = await axios.get(`${strapiBaseUrl}?filters[object_id][$eq]=${objectId}`, {
      headers: {
        Authorization: `Bearer ${API_TOKEN}`
      }
    });
    return response.data;
  } catch (error) {
    console.error(`Error fetching object with ID ${objectId}:`, error.message);
    return null;
  }
}

// Function to update a museum object
async function updateMuseumObject(id, updatedImgUrl) {
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
    console.log(`Updated object with ID: ${id}`);
  } catch (error) {
    console.error(`Error updating object with ID ${id}:`, error.message);
  }
}

// Sync all objects from the updated data file
async function syncObjects() {
  for (const updatedObject of updatedData) {
    const { object_id, img_url } = updatedObject;

    // Fetch the object from Hetzner Strapi by object_id
    const existingObject = await fetchMuseumObjectById(object_id);
    if (existingObject && existingObject.data.length > 0) {
      const objectId = existingObject.data[0].id; // Get the Strapi object ID
      console.log(`Updating object with ID ${objectId} and object_id ${object_id}...`);
      await updateMuseumObject(objectId, img_url);
    } else {
      console.log(`No matching object found for object_id: ${object_id}`);
    }
  }
  console.log('Content sync completed.');
}

// Start syncing the objects
syncObjects();
