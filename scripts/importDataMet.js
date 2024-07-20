const fs = require('fs');
const path = require('path');
const strapi = require(path.join(process.cwd(), 'node_modules', '@strapi', 'strapi'))();

const importData = async () => {
  // Start Strapi to make use of its ORM
  await strapi.start();

  // Read JSON file from the correct directory
  const dataPath = path.resolve(__dirname, '../../data/met_museum_objects_art_africa_5.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  // Iterate over the JSON data and insert into Strapi
  for (let item of data) {
    try {
      // Check if the item already exists
      const existingItem = await strapi.entityService.findMany('api::museum-object.museum-object', {
        filters: { object_id: item.object_id },
      });

      if (existingItem.length > 0) {
        console.log(`Item with ID: ${item.object_id} already exists. Skipping...`);
        continue;
      }

      // Ensure latitude and longitude are numbers or null
      const validateNumber = (value) => {
        if (value === null || value === 'N/A' || isNaN(value)) {
          return null;
        }
        return parseFloat(value);
      };

      const latitude = validateNumber(item.latitude);
      const longitude = validateNumber(item.longitude);
      const institutionLatitude = validateNumber(item.institution_latitude);
      const institutionLongitude = validateNumber(item.institution_longitude);

      // Log invalid lat/long values
      if (latitude === null || longitude === null) {
        console.log(`Invalid latitude or longitude for item with ID: ${item.object_id}. Setting to null.`);
      }

      // Convert time to an array and ensure time_start and time_end are strings
      const time = item.time ? [{
        ...item.time,
        time_start: item.time.time_start ? item.time.time_start.toString() : null,
        time_end: item.time.time_end ? item.time.time_end.toString() : null
      }] : [];

      // Create the item
      const createdItem = await strapi.entityService.create('api::museum-object.museum-object', {
        data: {
          object_id: item.object_id,
          title: item.title,
          img_url: item.img_url,
          latitude: latitude,
          longitude: longitude,
          institution_place: item.institution_place,
          source_link: item.source_link,
          institution_latitude: institutionLatitude,
          institution_longitude: institutionLongitude,
          institution_name: item.institution_name,
          place_name: item.place_name,
          time: time,
          inventory_number: item.inventory_number,
          object_links: item.object_links.length > 0 ? item.object_links.map(link => ({
            link_text: link.link_text.replace(/^"|"$/g, ''), // Remove surrounding quotes
            link_display: link.link_display.replace(/^"|"$/g, ''), // Remove surrounding quotes
          })) : [],
        },
      });
      console.log(`Inserted item with ID: ${item.object_id}`);
    } catch (error) {
      console.error(`Failed to insert item with ID: ${item.object_id}`);
      if (error.details && error.details.errors) {
        console.error('Validation Errors:', error.details.errors);
      } else {
        console.error('Unexpected Error:', error);
      }
    }
  }

  strapi.stop();
  console.log('Data import completed successfully.');
};

// Run the import function
importData().catch(error => {
  console.error('Error during data import:', error);
});
