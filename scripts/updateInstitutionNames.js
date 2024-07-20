const axios = require('axios');

const strapiBaseUrl = 'http://localhost:1337/api/museum-objects';
const API_TOKEN = '18d657083114a3fb6b99ebaf33fd080e562d439aa5ddf3200a77f2fae7b51d1dbb1e95f4a20e7772703a895e908a1e00a2b6bca76a09383743cf222ee0a76467bd1643c9bd25bb3cd73d8bfdd1ac7557d3a9ba7f3a8f1b0b1fb6d02ae5d393e27de9330d9090ee53262f2767dfb5857d225100d4c4de5537562d9c603bba4a42'; // Replace with your actual token

const institutions = [
  { name: 'Antikensammlung', latitude: 52.5206, longitude: 13.3989 },
  { name: 'Ethnologisches Museum', latitude: 52.5206, longitude: 13.3989 },
  { name: 'Gemäldegalerie', latitude: 52.5206, longitude: 13.3989 },
  { name: 'Kunstbibliothek', latitude: 52.5206, longitude: 13.3989 },
  { name: 'Kunstgewerbemuseum', latitude: 52.5206, longitude: 13.3989 },
  { name: 'Kupferstichkabinett', latitude: 52.5206, longitude: 13.3989 },
  { name: 'Museum Europäischer Kulturen', latitude: 52.5206, longitude: 13.3989 },
  { name: 'Museum für Asiatische Kunst', latitude: 52.5206, longitude: 13.3989 },
  { name: 'Museum für Islamische Kunst', latitude: 52.5206, longitude: 13.3989 },
  { name: 'Museum für Vor- und Frühgeschichte', latitude: 52.5206, longitude: 13.3989 },
  { name: 'Musikinstrumenten-Museum (im Staatlichen Institut für Musikforschung)', latitude: 52.5206, longitude: 13.3989 },
  { name: 'Münzkabinett', latitude: 52.52191544, longitude: 13.39418983 },
  { name: 'Nationalgalerie', latitude: 52.5206, longitude: 13.3989 },
  { name: 'Skulpturensammlung und Museum für Byzantinische Kunst', latitude: 52.5206, longitude: 13.3989 },
  { name: 'Vorderasiatisches Museum', latitude: 52.5206, longitude: 13.3989 },
  { name: 'Zentralarchiv der Staatlichen Museen zu Berlin', latitude: 52.5206, longitude: 13.3989 },
  { name: 'Ägyptisches Museum und Papyrussammlung', latitude: 52.5206, longitude: 13.3989 },
  // Add actual coordinates here
];

async function fetchEntries(page = 1) {
  try {
    const response = await axios.get(`${strapiBaseUrl}?pagination[page]=${page}&pagination[pageSize]=100`, {
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

async function updateEntry(id, institutionName) {
  try {
    await axios.put(`${strapiBaseUrl}/${id}`, {
      data: {
        institution_name: institutionName
      }
    }, {
      headers: {
        Authorization: `Bearer ${API_TOKEN}`
      }
    });
    console.log(`Updated entry with ID: ${id} to institution: ${institutionName}`);
  } catch (error) {
    console.error(`Error updating entry with ID ${id}:`, error.response ? error.response.data : error.message);
  }
}

async function updateAllEntries() {
  let page = 1;
  let totalPages = 1;
  let updatedCount = 0;
  let errorCount = 0;

  try {
    do {
      console.log(`Fetching entries (page ${page})...`);
      const data = await fetchEntries(page);

      if (data && data.data.length > 0) {
        for (const entry of data.data) {
          const { id, attributes } = entry;
          const { institution_latitude, institution_longitude } = attributes;
          const institution = institutions.find(inst => inst.latitude === institution_latitude && inst.longitude === institution_longitude);

          if (institution && attributes.institution_name !== institution.name) {
            try {
              await updateEntry(id, institution.name);
              updatedCount++;
            } catch (error) {
              errorCount++;
            }
          }
        }
      } else {
        console.log('No more entries found.');
        break;
      }

      totalPages = data.meta.pagination.pageCount;
      page += 1;

      console.log(`Progress: Updated ${updatedCount} entries, ${errorCount} errors`);

    } while (page <= totalPages);

    console.log(`All entries updated successfully. Total updated: ${updatedCount}, Total errors: ${errorCount}`);
  } catch (error) {
    console.error('Error updating entries:', error.response ? error.response.data : error.message);
  }
}

updateAllEntries();
