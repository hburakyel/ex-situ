const fetch = require('node-fetch');

const API_URL = 'http://127.0.0.1:1337/api/museum-objects';
const API_TOKEN = '18d657083114a3fb6b99ebaf33fd080e562d439aa5ddf3200a77f2fae7b51d1dbb1e95f4a20e7772703a895e908a1e00a2b6bca76a09383743cf222ee0a76467bd1643c9bd25bb3cd73d8bfdd1ac7557d3a9ba7f3a8f1b0b1fb6d02ae5d393e27de9330d9090ee53262f2767dfb5857d225100d4c4de5537562d9c603bba4a42'; // Replace with your actual token

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
