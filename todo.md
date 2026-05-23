In v3-resizable-object-container.tsx, fix and extend the download/export functionality.

CURRENT PROBLEM:
- CSV only exports currently loaded objects (infinite scroll subset)
- CSV missing image_url and source_url fields

WHAT TO BUILD:

1. FIX CSV — fetch ALL objects for current arc before export
   - Use current activeCountry + activeSite + activeInstitution filters
   - Paginate through ALL results (not just what's rendered)
   - Include all fields: title, inventory_number, place_name, 
     institution_name, date, source_url, image_url, 
     latitude, longitude
   - Filename: exsitu-[country]-[site]-[date].csv

2. ADD MD EXPORT — generate markdown provenance report
   - YAML frontmatter: filters, export_date, total_count
   - Origin sites table: place_name, coordinates, object_count, 
     first image_url as sample
   - Spatial distribution summary (top sites + percentages)
   - Pre-built LLM research prompt populated with actual place 
     names and counts
   - Filename: exsitu-[country]-[site]-[date].md

3. ADD JSON EXPORT — raw data
   - Export the full paginated dataset as JSON array
   - Include all fields same as CSV
   - Filename: exsitu-[country]-[site]-[date].json

4. UI — update the dropdown menu (the ··· button)
   - Download CSV
   - Export MD
   - Download JSON
   - Keep Share link as is

For MD export use this exact template structure 
(already proven, from existing exsitu MD exports):
- YAML frontmatter
- Origin sites table with sample images
- Spatial distribution percentages
- Research prompt block at bottom

Fetch all data using the existing API endpoint:
GET /api/museum-objects/geospatial with full pagination
Do not change any map logic, arc logic, or other components.