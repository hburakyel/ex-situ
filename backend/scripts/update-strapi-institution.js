require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fetch = require("node-fetch");

const STRAPI_URL = process.env.STRAPI_BASE_URL || "http://127.0.0.1:1337/api/museum-objects";
const API_TOKEN = process.env.API_TOKEN;
if (!API_TOKEN) { console.error('Missing API_TOKEN in .env'); process.exit(1); }
const BATCH_SIZE = 100; // Adjust batch size for performance

// Institution place to country mapping
const COUNTRY_MAPPING = {
  "Berlin": "Germany",
  "New York": "United States",
  // Add more mappings if needed
};

async function fetchPublishedObjects(page = 1) {
  try {
    const response = await fetch(
      `${STRAPI_URL}?pagination[page]=${page}&pagination[pageSize]=${BATCH_SIZE}&filters[institution_country][$null]=true&filters[publishedAt][$null]=false`,
      {
        headers: { Authorization: `Bearer ${API_TOKEN}` },
      }
    );
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error(`❌ Failed to fetch page ${page}:`, error);
    return [];
  }
}

async function updateObjects(objects) {
  const batchUpdates = objects.map((obj) => {
    const { id, attributes } = obj;
    const { institution_place, institution_country } = attributes;

    // Skip objects without institution_place or if already updated
    if (!institution_place || institution_country) return null;

    // Find matching country
    const newInstitutionCountry = COUNTRY_MAPPING[institution_place.trim()] || null;

    if (newInstitutionCountry) {
      return fetch(`${STRAPI_URL}/${id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          data: { institution_country: newInstitutionCountry },
        }),
      })
        .then((res) => res.ok && console.log(`✅ Updated ${id}: ${institution_place} → ${newInstitutionCountry}`))
        .catch((error) => console.error(`❌ Failed to update ${id}:`, error));
    }
    return null;
  });

  // Wait for all updates to complete
  await Promise.all(batchUpdates);
}

async function processObjects() {
  let page = 1;
  let objects;
  do {
    objects = await fetchPublishedObjects(page);
    if (objects.length > 0) {
      await updateObjects(objects);
      console.log(`🔄 Processed page ${page}`);
      page++;
    }
  } while (objects.length > 0);

  console.log("🎉 All published objects processed!");
}

// Run the update function
processObjects();
