const fs = require('fs');
const path = require('path');
const strapi = require(path.join(process.cwd(), 'node_modules', '@strapi', 'strapi'))();

const importData = async () => {
  // Start Strapi to make use of its ORM
  await strapi.start();

  // Read JSON file from the correct directory
  const dataPath = path.resolve(__dirname, '../../data/smb_islamische_kunst_objects.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  // Iterate over the JSON data and insert into Strapi
  for (let item of data) {
    try {
      // Check if the item already exists based on inventory_number
      const existingItem = await strapi.entityService.findMany('api::museum-object.museum-object', {
        filters: { inventory_number: item.inventory_number },
      });

      if (existingItem.length > 0) {
        console.log(`Item with Inventory Number: ${item.inventory_number} already exists. Skipping...`);
        continue;
      }

      // Ensure latitude and longitude are numbers or null
      const latitude = item.latitude !== 'N/A' ? parseFloat(item.latitude) : null;
      const longitude = item.longitude !== 'N/A' ? parseFloat(item.longitude) : null;
      const institutionLatitude = item.institution_latitude !== 'N/A' ? parseFloat(item.institution_latitude) : null;
      const institutionLongitude = item.institution_longitude !== 'N/A' ? parseFloat(item.institution_longitude) : null;

      // Convert time to an array if it is an object
      const time = item.time ? [item.time] : [];

      // Create the item if it does not exist
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
      console.log(`Inserted item with Inventory Number: ${item.inventory_number}`);
    } catch (error) {
      console.error(`Failed to insert item with Inventory Number: ${item.inventory_number}`);
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
