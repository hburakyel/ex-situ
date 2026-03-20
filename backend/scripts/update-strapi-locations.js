require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fetch = require("node-fetch");

const STRAPI_API_URL = process.env.STRAPI_BASE_URL || "http://127.0.0.1:1337/api/museum-objects";
const STRAPI_TOKEN = process.env.API_TOKEN;
if (!STRAPI_TOKEN) { console.error('Missing API_TOKEN in .env'); process.exit(1); }
const BATCH_SIZE = 100; // Number of objects to process at a time
const RETRY_LIMIT = 1; // Number of retries for failed updates

// Reverse Geocoding Function
async function fetchLocationData(latitude, longitude) {
    if (!latitude || !longitude || isNaN(latitude) || isNaN(longitude)) {
        return { city_en: "Unknown", country_en: "Unknown", city_native: "Unknown", country_native: "Unknown" };
    }

    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=en,ar`);
        const data = await response.json();

        if (data && data.address) {
            return {
                country_en: data.address.country || "Unknown",
                country_native: data.address["country"] || "Unknown",
                city_en: data.address.city || data.address.town || data.address.village || "Unknown",
                city_native: data.address.city || data.address.town || data.address.village || "Unknown",
            };
        }
    } catch (error) {
        console.error(`❌ Failed to fetch location data for ${latitude}, ${longitude}:`, error.message);
    }
    return { city_en: "Unknown", country_en: "Unknown", city_native: "Unknown", country_native: "Unknown" };
}

// Function to update a single Strapi object
async function updateStrapiObject(obj, retryCount = 0) {
    const { id, attributes } = obj;

    // Skip if lat/lon is missing
    if (!attributes.latitude || !attributes.longitude || isNaN(attributes.latitude) || isNaN(attributes.longitude)) {
        console.log(`⚠️ Skipping object ID ${id}: Missing or invalid lat/lon.`);
        return;
    }

    // Skip objects that already have country & city data
    if (attributes.country_en && attributes.city_en) {
        console.log(`⚠️ Skipping object ID ${id}: Already has country & city data.`);
        return;
    }

    // Fetch country/city data
    const locationData = await fetchLocationData(attributes.latitude, attributes.longitude);
    if (!locationData) {
        console.log(`⚠️ Skipping object ID ${id}: Failed to fetch location data.`);
        return;
    }

    // Prepare update payload
    const updatePayload = {
        data: {
            country_en: locationData.country_en,
            country_native: locationData.country_native,
            city_en: locationData.city_en,
            city_native: locationData.city_native,
        },
    };

    // Update object in Strapi
    try {
        await fetch(`${STRAPI_API_URL}/${id}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${STRAPI_TOKEN}`,
            },
            body: JSON.stringify(updatePayload),
        });

        console.log(`✅ Updated object ID ${id} with country and city data.`);
    } catch (error) {
        console.error(`❌ Failed to update object ID ${id}:`, error.message);

        if (retryCount < RETRY_LIMIT) {
            console.log(`🔄 Retrying update for object ID ${id}...`);
            return updateStrapiObject(obj, retryCount + 1);
        }

        console.log(`⚠️ Skipping object ID ${id} after ${RETRY_LIMIT} retries.`);
    }
}

// Function to fetch and update published Strapi objects
async function fetchAndUpdateObjects() {
    let page = 1;
    let totalPages = 1;

    console.log("🚀 Starting update process...");

    while (page <= totalPages) {
        try {
            const response = await fetch(`${STRAPI_API_URL}?pagination[page]=${page}&pagination[pageSize]=${BATCH_SIZE}&filters[publishedAt][$null]=false`, {
                headers: { Authorization: `Bearer ${STRAPI_TOKEN}` },
            });

            const result = await response.json();
            if (!result.data || result.data.length === 0) {
                console.log("✅ No more objects to process.");
                break;
            }

            totalPages = result.meta.pagination.pageCount;
            console.log(`📦 Processing batch ${page}/${totalPages}...`);

            for (const obj of result.data) {
                await updateStrapiObject(obj);
            }

            page++;
        } catch (error) {
            console.error(`❌ API fetch failed for page ${page}:`, error.message);
            break; // Stop processing if API fetching fails
        }
    }

    console.log("✅ All published objects processed!");
}

// Run the update function
fetchAndUpdateObjects();
