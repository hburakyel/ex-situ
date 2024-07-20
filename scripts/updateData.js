const fs = require('fs');
const path = require('path');
const strapi = require('@strapi/strapi');

const importData = async () => {
  // Bootstrap Strapi
  const app = await strapi().load();

  // Read JSON file from the correct directory
  const dataPath = path.resolve(__dirname, '../../data/ethnologisches_museum_objects.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  // Iterate over the JSON data and update or insert into Strapi
  for (let item of data) {
    try {
      // Check if the item already exists
      const existingItems = await app.entityService.findMany('api::museum-object.museum-object', {
        filters: { object_id: item.object_id },
      });

      // Ensure latitude and longitude are numbers or null
      const latitude = item.latitude !== 'N/A' ? parseFloat(item.latitude) : null;
      const longitude = item.longitude !== 'N/A' ? parseFloat(item.longitude) : null;
      const institutionLatitude = item.institution_latitude !== 'N/A' ? parseFloat(item.institution_latitude) : null;
      const institutionLongitude = item.institution_longitude !== 'N/A' ? parseFloat(item.institution_longitude) : null;

      // Convert time to an array if it is an object
      const time = item.time ? [item.time] : [];

      const dataToUpdate = {
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
      };

      if (existingItems.length > 0) {
        // Update the item if it exists
        await app.entityService.update('api::museum-object.museum-object', existingItems[0].id, {
          data: dataToUpdate,
        });
        console.log(`Updated item with ID: ${item.object_id}`);
      } else {
        // Create the item if it does not exist
        await app.entityService.create('api::museum-object.museum-object', {
          data: {
            object_id: item.object_id,
            ...dataToUpdate,
          },
        });
        console.log(`Inserted item with ID: ${item.object_id}`);
      }
    } catch (error) {
      console.error(`Failed to insert or update item with ID: ${item.object_id}`);
      if (error.details && error.details.errors) {
        console.error('Validation Errors:', error.details.errors);
      } else {
        console.error('Unexpected Error:', error);
      }
    }
  }

  await app.destroy(); // Correctly stop Strapi
  console.log('Data import completed successfully.');
};

// Run the import function
importData().catch(error => {
  console.error('Error during data import:', error);
});
