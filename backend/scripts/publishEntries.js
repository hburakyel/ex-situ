require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fetch = require('node-fetch');

const API_URL = process.env.STRAPI_BASE_URL || 'http://127.0.0.1:1337/api/museum-objects';
const API_TOKEN = process.env.API_TOKEN;
if (!API_TOKEN) { console.error('Missing API_TOKEN in .env'); process.exit(1); }

async function publishAllEntries() {
  try {
    // Fetch all entries
    const response = await fetch(API_URL, {
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();

    // Check if data is empty
    if (!data.data || data.data.length === 0) {
      console.log('No entries to publish.');
      return;
    }

    // Iterate through all entries and publish them
    for (const entry of data.data) {
      const entryId = entry.id;
      const publishResponse = await fetch(`${API_URL}/${entryId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ data: { publishedAt: new Date() } }) // Setting publishedAt to current date and time
      });

      if (publishResponse.ok) {
        console.log(`Published entry with ID: ${entryId}`);
      } else {
        console.error(`Failed to publish entry with ID: ${entryId}`);
      }
    }
  } catch (error) {
    console.error('Error publishing entries:', error);
  }
}

publishAllEntries();
