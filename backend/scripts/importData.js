const fs = require('fs');
const path = require('path');
const strapi = require(path.join(process.cwd(), 'node_modules', '@strapi', 'strapi'))();

const importData = async () => {
  // Start Strapi to make use of its ORM
  await strapi.start();

  // Read JSON file from the correct directory
  const dataPath = path.resolve(__dirname, '../../data/museum_objects.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  // Iterate over the JSON data and insert into Strapi
  for (let item of data) {
    try {
      const createdItem = await strapi.entityService.create('api::museum-object.museum-object', {
        data: {
          object_id: item.object_id,
          title: item.title,
          img_url: item.img_url,
          latitude: item.latitude,
          longitude: item.longitude,
          institution_place: item.institution_place,
          source_link: item.source_link,
          institution_latitude: item.institution_latitude,
          institution_longitude: item.institution_longitude,
          institution_name: item.institution_name,
          place_name: item.place_name,
          time: item.time ? {
            time_name: item.time.time_name,
            time_start: item.time.time_start,
            time_end: item.time.time_end,
          } : null,
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
