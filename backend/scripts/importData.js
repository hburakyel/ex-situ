const fs = require('fs');
const path = require('path');
const strapi = require(path.join(process.cwd(), 'node_modules', '@strapi', 'strapi'))();

const DRY_RUN = process.argv.includes('--dry-run');
if (DRY_RUN) console.log('🔍 DRY RUN — no records will be written to the database.');

const importData = async () => {
  // Start Strapi to make use of its ORM
  await strapi.start();

  // Read JSON file from the correct directory
  const dataPath = path.resolve(__dirname, '../../data/museum_objects.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  let inserted = 0, skipped = 0, failed = 0;

  // Iterate over the JSON data and insert into Strapi
  for (let item of data) {
    try {
      // Idempotency check — skip if this institution already has this object_id.
      // object_id alone is not globally unique: it's each source's own numbering
      // scheme, so e.g. AIC object_id 26516 and Ethnologisches Museum object_id
      // 26516 are unrelated objects that happen to share a number.
      const existing = await strapi.entityService.findMany('api::museum-object.museum-object', {
        filters: {
          object_id: { $eq: item.object_id },
          institution_name: { $eq: item.institution_name },
        },
        fields: ['id'],
        limit: 1,
      });

      if (existing && existing.length > 0) {
        console.log(`⚠️ Skipping ${item.institution_name} object_id ${item.object_id}: already exists (id=${existing[0].id}).`);
        skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`🔍 [DRY RUN] Would insert object_id: ${item.object_id}`);
        inserted++;
        continue;
      }

      await strapi.entityService.create('api::museum-object.museum-object', {
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
          // `time` is a repeatable component — Strapi expects an array, not a
          // bare object. time_start/time_end are declared as string fields
          // in the component schema, so coerce non-null numbers explicitly.
          time: item.time && (item.time.time_name || item.time.time_start != null || item.time.time_end != null) ? [{
            time_name: item.time.time_name != null ? String(item.time.time_name) : null,
            time_start: item.time.time_start != null ? String(item.time.time_start) : null,
            time_end: item.time.time_end != null ? String(item.time.time_end) : null,
          }] : [],
          inventory_number: item.inventory_number,
          object_links: item.object_links.length > 0 ? item.object_links.map(link => ({
            link_text: link.link_text.replace(/^"|"$/g, ''),
            link_display: link.link_display.replace(/^"|"$/g, ''),
          })) : [],
        },
      });
      console.log(`✅ Inserted object_id: ${item.object_id}`);
      inserted++;
    } catch (error) {
      console.error(`❌ Failed to insert object_id: ${item.object_id}`);
      if (error.details && error.details.errors) {
        console.error('Validation Errors:', error.details.errors);
      } else {
        console.error('Unexpected Error:', error);
      }
      failed++;
    }
  }

  strapi.stop();
  console.log(`\n✅ Import complete — inserted: ${inserted}, skipped: ${skipped}, failed: ${failed}${DRY_RUN ? ' (DRY RUN)' : ''}.`);
};

// Run the import function
importData().catch(error => {
  console.error('Error during data import:', error);
});
