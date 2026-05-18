require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fetch = require("node-fetch");

const STRAPI_API_URL = process.env.STRAPI_BASE_URL || "http://127.0.0.1:1337/api/museum-objects";
const STRAPI_TOKEN = process.env.API_TOKEN;
if (!STRAPI_TOKEN) { console.error('Missing API_TOKEN in .env'); process.exit(1); }
const BATCH_SIZE = 100;
const NOMINATIM_MAX_RETRIES = 4;   // attempts: 1 initial + 3 retries
const NOMINATIM_BASE_DELAY_MS = 1100; // 1.1s base — respects Nominatim 1 req/s limit
const DRY_RUN = process.argv.includes('--dry-run');

if (DRY_RUN) console.log('🔍 DRY RUN — no writes will be made.');

/** Sleep for ms milliseconds */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Reverse geocode with exponential backoff retry */
async function fetchLocationData(latitude, longitude, attempt = 1) {
    if (!latitude || !longitude || isNaN(latitude) || isNaN(longitude)) {
        return { city_en: "Unknown", country_en: "Unknown", city_native: "Unknown", country_native: "Unknown" };
    }

    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=en,ar`,
            { headers: { 'User-Agent': 'ex-situ/1.0 (https://exsitu.app)' } }
        );

        if (response.status === 429 || response.status >= 500) {
            throw new Error(`HTTP ${response.status}`);
        }

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
        if (attempt < NOMINATIM_MAX_RETRIES) {
            const delay = NOMINATIM_BASE_DELAY_MS * Math.pow(2, attempt - 1);
            console.warn(`⚠️  Nominatim error (attempt ${attempt}/${NOMINATIM_MAX_RETRIES}) for ${latitude},${longitude}: ${error.message} — retrying in ${delay}ms`);
            await sleep(delay);
            return fetchLocationData(latitude, longitude, attempt + 1);
        }
        console.error(`❌ Nominatim failed after ${NOMINATIM_MAX_RETRIES} attempts for ${latitude},${longitude}:`, error.message);
    }
    return { city_en: "Unknown", country_en: "Unknown", city_native: "Unknown", country_native: "Unknown" };
}

// Function to update a single Strapi object
async function updateStrapiObject(obj) {
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

    // Fetch country/city data (with exponential backoff built in)
    const locationData = await fetchLocationData(attributes.latitude, attributes.longitude);
    if (!locationData) {
        console.log(`⚠️ Skipping object ID ${id}: Failed to fetch location data.`);
        return;
    }

    const updatePayload = {
        data: {
            country_en: locationData.country_en,
            country_native: locationData.country_native,
            city_en: locationData.city_en,
            city_native: locationData.city_native,
        },
    };

    if (DRY_RUN) {
        console.log(`🔍 [DRY RUN] Would update object ID ${id}:`, JSON.stringify(updatePayload.data));
        return;
    }

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
