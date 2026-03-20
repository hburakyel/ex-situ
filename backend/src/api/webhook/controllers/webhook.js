module.exports = {
  async handle(ctx) {
      if (ctx.request.method !== 'POST') {
          ctx.response.status = 405;
          return ctx.response.send({ message: 'Method Not Allowed' });
      }

      try {
          console.log('Webhook received:', ctx.request.body);

          // Fetch all museum objects
          const museumObjects = await strapi.entityService.findMany("api::museum-object.museum-object", {
              fields: [
                  "object_id",
                  "title",
                  "img_url",
                  "latitude",
                  "longitude",
                  "institution_place",
                  "institution_country",
                  "source_link",
                  "institution_name",
                  "place_name",
                  "inventory_number",
                  "institution_longitude",
                  "institution_latitude",
                  "country_en",
                  "country_native",
                  "city_native",
                  "city_en"
              ],
              filters: {}, // No specific filters for now
              populate: {
                  object_links: true // If object_links is a relation, include it
              }
          });

          // Aggregate data by institution
          const summary = museumObjects.reduce((acc, obj) => {
              const key = `${obj.country_en}-${obj.city_en}-${obj.institution_name}`;
              if (!acc[key]) {
                  acc[key] = {
                      country_en: obj.country_en,
                      country_native: obj.country_native,
                      city_en: obj.city_en,
                      city_native: obj.city_native,
                      institution_name: obj.institution_name,
                      institution_place: obj.institution_place,
                      institution_country: obj.institution_country,
                      institution_latitude: obj.institution_latitude,
                      institution_longitude: obj.institution_longitude,
                      total_objects: 0,
                      objects: [] // Store full object details
                  };
              }
              acc[key].total_objects += 1;
              acc[key].objects.push({
                  object_id: obj.object_id,
                  title: obj.title,
                  img_url: obj.img_url,
                  latitude: obj.latitude,
                  longitude: obj.longitude,
                  source_link: obj.source_link,
                  place_name: obj.place_name,
                  inventory_number: obj.inventory_number,
                  object_links: obj.object_links || []
              });
              return acc;
          }, {});

          // Convert to array
          const result = Object.values(summary);

          return ctx.response.send({
              success: true,
              data: result
          });

      } catch (error) {
          ctx.response.status = 500;
          return ctx.response.send({ success: false, error: error.message });
      }
  },
};
