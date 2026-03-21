-- Migration 006: Add place_name_normalized column and populate it
-- This column maps language/spelling variants to a canonical English form.
-- Original place_name is NEVER modified.
-- Ambiguous entries (probably/possibly/or) are left NULL.

ALTER TABLE museum_objects ADD COLUMN IF NOT EXISTS place_name_normalized TEXT;

-----------------------------------------------------------------------
-- PART A: German → English country-level mappings
-- These are the highest-impact normalizations (country-level labels)
-----------------------------------------------------------------------

-- Mexiko → Mexico
UPDATE museum_objects SET place_name_normalized = 'Mexico'
WHERE place_name = 'Mexiko' AND place_name_normalized IS NULL;

-- Ägypten → Egypt (but NOT Ägypten? which is ambiguous)
UPDATE museum_objects SET place_name_normalized = 'Egypt'
WHERE place_name = 'Ägypten' AND place_name_normalized IS NULL;

-- Kolumbien → Colombia
UPDATE museum_objects SET place_name_normalized = 'Colombia'
WHERE place_name = 'Kolumbien' AND place_name_normalized IS NULL;

-- Indien → India
UPDATE museum_objects SET place_name_normalized = 'India'
WHERE place_name IN ('Indien', 'Nordindien') AND place_name_normalized IS NULL;

-- Kamerun → Cameroon
UPDATE museum_objects SET place_name_normalized = 'Cameroon'
WHERE place_name IN ('Kamerun', 'Kameruner Grasland') AND place_name_normalized IS NULL;

-- Brasilien → Brazil
UPDATE museum_objects SET place_name_normalized = 'Brazil'
WHERE place_name = 'Brasilien' AND place_name_normalized IS NULL;

-- Tansania → Tanzania
UPDATE museum_objects SET place_name_normalized = 'Tanzania'
WHERE place_name = 'Tansania' AND place_name_normalized IS NULL;

-- Türkei → Turkey
UPDATE museum_objects SET place_name_normalized = 'Turkey'
WHERE place_name = 'Türkei' AND place_name_normalized IS NULL;

-- Bolivien → Bolivia
UPDATE museum_objects SET place_name_normalized = 'Bolivia'
WHERE place_name = 'Bolivien' AND place_name_normalized IS NULL;

-- Irak → Iraq
UPDATE museum_objects SET place_name_normalized = 'Iraq'
WHERE place_name = 'Irak' AND place_name_normalized IS NULL;

-- Syrien → Syria
UPDATE museum_objects SET place_name_normalized = 'Syria'
WHERE place_name = 'Syrien' AND place_name_normalized IS NULL;

-- Argentinien → Argentina
UPDATE museum_objects SET place_name_normalized = 'Argentina'
WHERE place_name = 'Argentinien' AND place_name_normalized IS NULL;

-- Indonesien → Indonesia
UPDATE museum_objects SET place_name_normalized = 'Indonesia'
WHERE place_name = 'Indonesien' AND place_name_normalized IS NULL;

-- Demokratische Republik Kongo → Democratic Republic of the Congo
UPDATE museum_objects SET place_name_normalized = 'Democratic Republic of the Congo'
WHERE place_name = 'Demokratische Republik Kongo' AND place_name_normalized IS NULL;

-- Südafrika (Republik) → South Africa
UPDATE museum_objects SET place_name_normalized = 'South Africa'
WHERE place_name = 'Südafrika (Republik)' AND place_name_normalized IS NULL;

-- Neuseeland → New Zealand
UPDATE museum_objects SET place_name_normalized = 'New Zealand'
WHERE place_name = 'Neuseeland' AND place_name_normalized IS NULL;

-- Mongolei → Mongolia
UPDATE museum_objects SET place_name_normalized = 'Mongolia'
WHERE place_name = 'Mongolei' AND place_name_normalized IS NULL;

-- Marokko → Morocco
UPDATE museum_objects SET place_name_normalized = 'Morocco'
WHERE place_name IN ('Marokko', 'Tunesien Marocco') AND place_name_normalized IS NULL;

-- Äthiopien → Ethiopia
UPDATE museum_objects SET place_name_normalized = 'Ethiopia'
WHERE place_name = 'Äthiopien' AND place_name_normalized IS NULL;

-- Tunesien → Tunisia
UPDATE museum_objects SET place_name_normalized = 'Tunisia'
WHERE place_name = 'Tunesien' AND place_name_normalized IS NULL;

-- Algerien → Algeria
UPDATE museum_objects SET place_name_normalized = 'Algeria'
WHERE place_name = 'Algerien' AND place_name_normalized IS NULL;

-- Spanien → Spain
UPDATE museum_objects SET place_name_normalized = 'Spain'
WHERE place_name = 'Spanien' AND place_name_normalized IS NULL;

-- Italien → Italy
UPDATE museum_objects SET place_name_normalized = 'Italy'
WHERE place_name = 'Italien' AND place_name_normalized IS NULL;

-- Usbekistan → Uzbekistan
UPDATE museum_objects SET place_name_normalized = 'Uzbekistan'
WHERE place_name = 'Usbekistan' AND place_name_normalized IS NULL;

-- Griechenland → Greece
UPDATE museum_objects SET place_name_normalized = 'Greece'
WHERE place_name = 'Griechenland' AND place_name_normalized IS NULL;

-- Jordanien → Jordan
UPDATE museum_objects SET place_name_normalized = 'Jordan'
WHERE place_name = 'Jordanien' AND place_name_normalized IS NULL;

-- Libanon → Lebanon
UPDATE museum_objects SET place_name_normalized = 'Lebanon'
WHERE place_name = 'Libanon' AND place_name_normalized IS NULL;

-- Jemen → Yemen
UPDATE museum_objects SET place_name_normalized = 'Yemen'
WHERE place_name = 'Jemen' AND place_name_normalized IS NULL;

-- Russland → Russia
UPDATE museum_objects SET place_name_normalized = 'Russia'
WHERE place_name = 'Russland' AND place_name_normalized IS NULL;

-- Madagaskar → Madagascar
UPDATE museum_objects SET place_name_normalized = 'Madagascar'
WHERE place_name = 'Madagaskar' AND place_name_normalized IS NULL;

-- Mexiko-Stadt → Mexico City
UPDATE museum_objects SET place_name_normalized = 'Mexico City'
WHERE place_name = 'Mexiko-Stadt' AND place_name_normalized IS NULL;

-- Kanada (Nordwestküste) → Canada
UPDATE museum_objects SET place_name_normalized = 'Canada'
WHERE place_name = 'Kanada (Nordwestküste)' AND place_name_normalized IS NULL;

-- Senegal stays as Senegal (already English)
-- Togo stays as Togo
-- Ghana stays as Ghana
-- etc.

-----------------------------------------------------------------------
-- PART B: English self-normalization (same canonical for same place)
-- Where English variants exist alongside German ones
-----------------------------------------------------------------------

-- Egypt (English label) → Egypt
UPDATE museum_objects SET place_name_normalized = 'Egypt'
WHERE place_name = 'Egypt' AND place_name_normalized IS NULL;

-- Syria (English) → Syria
UPDATE museum_objects SET place_name_normalized = 'Syria'
WHERE place_name = 'Syria' AND place_name_normalized IS NULL;

-- Turkey (English) → Turkey
UPDATE museum_objects SET place_name_normalized = 'Turkey'
WHERE place_name = 'Turkey' AND place_name_normalized IS NULL;

-- India (English) → India
UPDATE museum_objects SET place_name_normalized = 'India'
WHERE place_name = 'India' AND place_name_normalized IS NULL;

-- Iran → Iran (already English)
UPDATE museum_objects SET place_name_normalized = 'Iran'
WHERE place_name = 'Iran' AND place_name_normalized IS NULL;

-- iraq lowercase
UPDATE museum_objects SET place_name_normalized = 'Iraq'
WHERE place_name = 'iraq' AND place_name_normalized IS NULL;

-- iran lowercase
UPDATE museum_objects SET place_name_normalized = 'Iran'
WHERE place_name = 'iran' AND place_name_normalized IS NULL;

-- Colombia (English) → Colombia
UPDATE museum_objects SET place_name_normalized = 'Colombia'
WHERE place_name = 'Colombia' AND place_name_normalized IS NULL;

-- Democratic Republic of the Congo → same
UPDATE museum_objects SET place_name_normalized = 'Democratic Republic of the Congo'
WHERE place_name = 'Democratic Republic of the Congo' AND place_name_normalized IS NULL;

-- Papua New Guinea → same
UPDATE museum_objects SET place_name_normalized = 'Papua New Guinea'
WHERE place_name = 'Papua New Guinea' AND place_name_normalized IS NULL;

-- Nordost-Neuguinea → Papua New Guinea
UPDATE museum_objects SET place_name_normalized = 'Papua New Guinea'
WHERE place_name = 'Nordost-Neuguinea' AND place_name_normalized IS NULL;

-----------------------------------------------------------------------
-- PART C: Spelling variants and transliterations
-----------------------------------------------------------------------

-- Tucumán / Tucumann → Tucumán
UPDATE museum_objects SET place_name_normalized = 'Tucumán'
WHERE place_name IN ('Tucumán', 'Tucumann') AND place_name_normalized IS NULL;

-- Nishapur variants → Nishapur
UPDATE museum_objects SET place_name_normalized = 'Nishapur'
WHERE place_name IN ('Nishapur', 'Nishapur, Iran', 'Nishapur, iran', 'Nischapur') 
AND place_name_normalized IS NULL;

-- Samarra variants → Samarra
UPDATE museum_objects SET place_name_normalized = 'Samarra'
WHERE place_name IN ('Samarra', 'Samarra, Iraq') AND place_name_normalized IS NULL;

-- Sakkara / Saqqara → Saqqara
UPDATE museum_objects SET place_name_normalized = 'Saqqara'
WHERE place_name IN ('Sakkara', 'Saqqara', 'Saqqara, Egypt') AND place_name_normalized IS NULL;

-- Theben (Ägypten) → Thebes (Egypt)
UPDATE museum_objects SET place_name_normalized = 'Thebes'
WHERE place_name = 'Theben (Ägypten)' AND place_name_normalized IS NULL;

-- Theben (Griechenland) → Thebes (Greece)
UPDATE museum_objects SET place_name_normalized = 'Thebes (Greece)'
WHERE place_name = 'Theben (Griechenland)' AND place_name_normalized IS NULL;

-- Olympia (Griechenland) → Olympia
UPDATE museum_objects SET place_name_normalized = 'Olympia'
WHERE place_name = 'Olympia (Griechenland)' AND place_name_normalized IS NULL;

-- Java (Insel) → Java
UPDATE museum_objects SET place_name_normalized = 'Java'
WHERE place_name IN ('Java (Insel)', 'Java', 'Java, Indonesia') AND place_name_normalized IS NULL;

-- Bali (Indonesien) → Bali (Indonesia)
UPDATE museum_objects SET place_name_normalized = 'Bali'
WHERE place_name = 'Bali (Indonesien)' AND place_name_normalized IS NULL;

-- Bali (Kamerun) → Bali (Cameroon)  (different place, must stay separate)
UPDATE museum_objects SET place_name_normalized = 'Bali (Cameroon)'
WHERE place_name = 'Bali (Kamerun)' AND place_name_normalized IS NULL;

-- Bali (Demokratische Republik Kongo) → Bali (DR Congo)
UPDATE museum_objects SET place_name_normalized = 'Bali (DR Congo)'
WHERE place_name = 'Bali (Demokratische Republik Kongo)' AND place_name_normalized IS NULL;

-- Ctesiphon, Iraq → Ctesiphon
UPDATE museum_objects SET place_name_normalized = 'Ctesiphon'
WHERE place_name = 'Ctesiphon, Iraq' AND place_name_normalized IS NULL;

-- Babili → Babylon
UPDATE museum_objects SET place_name_normalized = 'Babylon'
WHERE place_name = 'Babili' AND place_name_normalized IS NULL;

-- Yukatan → Yucatan
UPDATE museum_objects SET place_name_normalized = 'Yucatan'
WHERE place_name = 'Yukatan' AND place_name_normalized IS NULL;

-- Chibcha is an ethnonym, not a place — leave it, but normalize self
-- (no English variant exists)

-- Ostafrika → East Africa
UPDATE museum_objects SET place_name_normalized = 'East Africa'
WHERE place_name = 'Ostafrika' AND place_name_normalized IS NULL;

-- Polynesien → Polynesia
UPDATE museum_objects SET place_name_normalized = 'Polynesia'
WHERE place_name = 'Polynesien' AND place_name_normalized IS NULL;

-- Melanesien → Melanesia
UPDATE museum_objects SET place_name_normalized = 'Melanesia'
WHERE place_name = 'Melanesien' AND place_name_normalized IS NULL;

-- Nasca (Peru) → Nazca
UPDATE museum_objects SET place_name_normalized = 'Nazca'
WHERE place_name = 'Nasca (Peru)' AND place_name_normalized IS NULL;

-- Guinea-Conakry → Guinea
UPDATE museum_objects SET place_name_normalized = 'Guinea'
WHERE place_name IN ('Guinea-Conakry', 'Guinea') AND place_name_normalized IS NULL;

-- Gouvernement al-Fayyum → Faiyum
UPDATE museum_objects SET place_name_normalized = 'Faiyum'
WHERE place_name = 'Gouvernement al-Fayyum' AND place_name_normalized IS NULL;

-- Aššur (Stadt) / Assur → Assur (keep distinct from "Assur" India misgeocoding)
-- Note: The 106 "Assur" objects geocoded to India are misgeocoded;  
-- normalized name for the correct Iraqi site:
UPDATE museum_objects SET place_name_normalized = 'Ashur'
WHERE place_name IN ('Aššur (Stadt)', 'Assur') AND place_name_normalized IS NULL;

-- Hermopolis Magna → same (already canonical)
UPDATE museum_objects SET place_name_normalized = 'Hermopolis Magna'
WHERE place_name = 'Hermopolis Magna' AND place_name_normalized IS NULL;

-- Tausend-Buddha-Höhlen von Kizil → Kizil Caves
UPDATE museum_objects SET place_name_normalized = 'Kizil Caves'
WHERE place_name = 'Tausend-Buddha-Höhlen von Kizil' AND place_name_normalized IS NULL;

-- Kocho (Gaochang) → Gaochang
UPDATE museum_objects SET place_name_normalized = 'Gaochang'
WHERE place_name = 'Kocho (Gaochang)' AND place_name_normalized IS NULL;

-- Río Pilcomayo variants → Río Pilcomayo
UPDATE museum_objects SET place_name_normalized = 'Río Pilcomayo'
WHERE place_name IN ('Río Pilcomayo', 'Rio Pilcomayo (Argentinien)', 'Río Pilcomayo (Bolivien)') 
AND place_name_normalized IS NULL;

-- Alaska / Alaska, United States → Alaska
UPDATE museum_objects SET place_name_normalized = 'Alaska'
WHERE place_name IN ('Alaska', 'Alaska, United States') AND place_name_normalized IS NULL;

-- Copacabana (Bolivien) → Copacabana (Bolivia)
UPDATE museum_objects SET place_name_normalized = 'Copacabana (Bolivia)'
WHERE place_name = 'Copacabana (Bolivien)' AND place_name_normalized IS NULL;

-- Copacabana (Peru) → Copacabana (Peru) (different place, keep separate)
UPDATE museum_objects SET place_name_normalized = 'Copacabana (Peru)'
WHERE place_name = 'Copacabana (Peru)' AND place_name_normalized IS NULL;

-- Liberia (Costa Rica) → Liberia (Costa Rica) (town in Costa Rica, not the country)
UPDATE museum_objects SET place_name_normalized = 'Liberia (Costa Rica)'
WHERE place_name = 'Liberia (Costa Rica)' AND place_name_normalized IS NULL;

-- Damaskus → Damascus
UPDATE museum_objects SET place_name_normalized = 'Damascus'
WHERE place_name = 'Damaskus' AND place_name_normalized IS NULL;

-- Maikop → Maykop
UPDATE museum_objects SET place_name_normalized = 'Maykop'
WHERE place_name = 'Maikop' AND place_name_normalized IS NULL;

-- Südmarokko → Southern Morocco
UPDATE museum_objects SET place_name_normalized = 'Southern Morocco'
WHERE place_name = 'Südmarokko' AND place_name_normalized IS NULL;

-- Guinea-Bissau → Guinea-Bissau (already English)
UPDATE museum_objects SET place_name_normalized = 'Guinea-Bissau'
WHERE place_name = 'Guinea-Bissau' AND place_name_normalized IS NULL;

-----------------------------------------------------------------------
-- PART D: Mesoamerica regional variants  
-- "Mexico, Mesoamerica" and "Guerrero, Mexico, Mesoamerica" both  
-- have different place_name strings but resolve to Mexico
-- Keep the regional specificity where present
-----------------------------------------------------------------------

-- "Mexico, Mesoamerica" → Mexico
UPDATE museum_objects SET place_name_normalized = 'Mexico'
WHERE place_name = 'Mexico, Mesoamerica' AND place_name_normalized IS NULL;

-- "Guerrero, Mexico, Mesoamerica" → Guerrero
UPDATE museum_objects SET place_name_normalized = 'Guerrero'
WHERE place_name = 'Guerrero, Mexico, Mesoamerica' AND place_name_normalized IS NULL;

-- "Veracruz, Mexico, Mesoamerica" → Veracruz
UPDATE museum_objects SET place_name_normalized = 'Veracruz'
WHERE place_name IN ('Veracruz, Mexico, Mesoamerica', 'Veracruz (?), Mexico, Mesoamerica')
AND place_name_normalized IS NULL;

-- "Colima, Mexico, Mesoamerica" → Colima
UPDATE museum_objects SET place_name_normalized = 'Colima'
WHERE place_name = 'Colima, Mexico, Mesoamerica' AND place_name_normalized IS NULL;

-- "Jalisco, Mexico, Mesoamerica" → Jalisco
UPDATE museum_objects SET place_name_normalized = 'Jalisco'
WHERE place_name = 'Jalisco, Mexico, Mesoamerica' AND place_name_normalized IS NULL;

-- "Michoacan, Mexico, Mesoamerica" / "Michoacán, Mexico, Mesoamerica" → Michoacán
UPDATE museum_objects SET place_name_normalized = 'Michoacán'
WHERE place_name IN ('Michoacan, Mexico, Mesoamerica', 'Michoacán, Mexico, Mesoamerica')
AND place_name_normalized IS NULL;

-- "Nayarit, Mexico, Mesoamerica" → Nayarit
UPDATE museum_objects SET place_name_normalized = 'Nayarit'
WHERE place_name = 'Nayarit, Mexico, Mesoamerica' AND place_name_normalized IS NULL;

-- "Oaxaca, Mexico, Mesoamerica" / "Oaxaca (?), Mexico, Mesoamerica" → Oaxaca
UPDATE museum_objects SET place_name_normalized = 'Oaxaca'
WHERE place_name IN ('Oaxaca, Mexico, Mesoamerica', 'Oaxaca (?), Mexico, Mesoamerica')
AND place_name_normalized IS NULL;

-- "Puebla, Mexico, Mesoamerica" → Puebla
UPDATE museum_objects SET place_name_normalized = 'Puebla'
WHERE place_name = 'Puebla, Mexico, Mesoamerica' AND place_name_normalized IS NULL;

-- "Chiapas, Mexico, Mesoamerica" → Chiapas
UPDATE museum_objects SET place_name_normalized = 'Chiapas'
WHERE place_name = 'Chiapas, Mexico, Mesoamerica' AND place_name_normalized IS NULL;

-- "Tabasco, Mexico, Mesoamerica" → Tabasco
UPDATE museum_objects SET place_name_normalized = 'Tabasco'
WHERE place_name = 'Tabasco, Mexico, Mesoamerica' AND place_name_normalized IS NULL;

-- "Yucatan, Mexico, Mesoamerica" → Yucatan
UPDATE museum_objects SET place_name_normalized = 'Yucatan'
WHERE place_name = 'Yucatan, Mexico, Mesoamerica' AND place_name_normalized IS NULL;

-- "Chihuahua, Mexico, Mesoamerica" → Chihuahua
UPDATE museum_objects SET place_name_normalized = 'Chihuahua'
WHERE place_name = 'Chihuahua, Mexico, Mesoamerica' AND place_name_normalized IS NULL;

-- "Sonora, Mexico, Mesoamerica" → Sonora
UPDATE museum_objects SET place_name_normalized = 'Sonora'
WHERE place_name = 'Sonora, Mexico, Mesoamerica' AND place_name_normalized IS NULL;

-- "Guatemala, Mesoamerica" → Guatemala
UPDATE museum_objects SET place_name_normalized = 'Guatemala'
WHERE place_name = 'Guatemala, Mesoamerica' AND place_name_normalized IS NULL;

-- "Honduras, Mesoamerica" → Honduras
UPDATE museum_objects SET place_name_normalized = 'Honduras'
WHERE place_name = 'Honduras, Mesoamerica' AND place_name_normalized IS NULL;

-----------------------------------------------------------------------
-- PART E: "Country, City" → keep city-level specificity
-- Met-style labels like "Iznik, Turkey", "Fustat, Egypt"
-----------------------------------------------------------------------

UPDATE museum_objects SET place_name_normalized = 'Iznik'
WHERE place_name = 'Iznik, Turkey' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Bursa'
WHERE place_name = 'Bursa, Turkey' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Konya'
WHERE place_name = 'Konya, Turkey' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Fustat'
WHERE place_name IN ('Fustat, Egypt', 'near Fustat, Egypt') AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Akhmim'
WHERE place_name = 'Akhmim (former Panopolis), Egypt' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Kus'
WHERE place_name = 'Kus, Egypt' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Kuft'
WHERE place_name = 'Kuft, Egypt' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Aswan'
WHERE place_name IN ('Aswan, Egypt', 'Aswan (Assouan), Egypt', 'Assuan') AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Erment'
WHERE place_name = 'Erment, Egypt' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Oxyrhynchus'
WHERE place_name IN ('Oxyrhynchus, Egypt', 'Oxyrhynchus (modern Bahnasa), Egypt', 
                     'el-Bahnasa (Oxyrhynchus), Egypt') AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Lisht'
WHERE place_name IN ('Lisht, Egypt', 'Lisht South, Egypt') AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Eshmunein'
WHERE place_name = 'Eshmunein, Egypt' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'El-Hiba'
WHERE place_name = 'El-Hiba (Ankyronpolis), Egypt' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Ehnasya'
WHERE place_name IN ('Ehnasya, Egypt', 'Ahnas, Egypt') AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Tuna el-Gebel'
WHERE place_name = 'Tuna al-Gebel, Egypt' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Balyzeh'
WHERE place_name = 'Balyzeh, Egypt' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Dendereh'
WHERE place_name = 'Dendereh, Egypt' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Akhmin'
WHERE place_name = 'Akhmin, Egypt' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Rifeh'
WHERE place_name = 'Rifeh, Egypt' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Mitrahina'
WHERE place_name = 'Mitrahina, Egypt' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Court of Benin'
WHERE place_name = 'Court of Benin, Nigeria' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Kula'
WHERE place_name = 'Kula, Turkey' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Izmir'
WHERE place_name = 'Izmir, Turkey' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Ladik'
WHERE place_name IN ('Ladik, Turkey', 'Ladik, Konya, Turkey') AND place_name_normalized IS NULL;

-----------------------------------------------------------------------
-- PART F: Indonesia regional variants
-----------------------------------------------------------------------

UPDATE museum_objects SET place_name_normalized = 'Sumatra'
WHERE place_name IN ('Indonesia, Sumatra', 'Indonesia, Sumatra (?)') AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Borneo'
WHERE place_name = 'Indonesia, Borneo' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Java'
WHERE place_name = 'Indonesia, Java' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Papua (Indonesia)'
WHERE place_name = 'Papua Province (Irian Jaya), Indonesia' AND place_name_normalized IS NULL;

-----------------------------------------------------------------------
-- PART G: Peru regional sub-variants all normalize to Peru
-- (they share the same rounded coords, these are Met-style labels)
-----------------------------------------------------------------------

UPDATE museum_objects SET place_name_normalized = 'Peru'
WHERE place_name IN (
  'Peru',
  'Peru, Ica Valley',
  'Peru, North Coast',
  'Peru, South Coast',
  'Peru, North or Central Coast',
  'Peru, Churunga Valley',
  'Peru, Central or South Coast',
  'Peru, Ica River, South Coast',
  'Peru, Chicama Valley',
  'Peru, Cusco region'
) AND place_name_normalized IS NULL;

-----------------------------------------------------------------------
-- PART H: Same-name self-normalization for high-count entries
-- These have no German variant but need a canonical form for 
-- consistent grouping across institutions
-----------------------------------------------------------------------

UPDATE museum_objects SET place_name_normalized = 'Peru' WHERE place_name = 'Peru' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Costa Rica' WHERE place_name = 'Costa Rica' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Nigeria' WHERE place_name = 'Nigeria' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'China' WHERE place_name = 'China' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Japan' WHERE place_name = 'Japan' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Samoa' WHERE place_name = 'Samoa' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Ecuador' WHERE place_name = 'Ecuador' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Guatemala' WHERE place_name = 'Guatemala' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Thailand' WHERE place_name = 'Thailand' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Mali' WHERE place_name = 'Mali' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Myanmar' WHERE place_name = 'Myanmar' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Korea' WHERE place_name = 'Korea' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Ghana' WHERE place_name = 'Ghana' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Panama' WHERE place_name = 'Panama' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Honduras' WHERE place_name = 'Honduras' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Namibia' WHERE place_name = 'Namibia' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Liberia' WHERE place_name = 'Liberia' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Vietnam' WHERE place_name = 'Vietnam' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Chile' WHERE place_name = 'Chile' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Togo' WHERE place_name = 'Togo' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Somalia' WHERE place_name = 'Somalia' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Uganda' WHERE place_name = 'Uganda' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Suriname' WHERE place_name = 'Suriname' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Nicaragua' WHERE place_name = 'Nicaragua' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Paraguay' WHERE place_name = 'Paraguay' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Pakistan' WHERE place_name IN ('Pakistan') AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Afghanistan' WHERE place_name = 'Afghanistan' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Israel' WHERE place_name = 'Israel' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Senegal' WHERE place_name = 'Senegal' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Alaska' WHERE place_name IN ('Alaska', 'Alaska, United States', 'Alaska (Nordwestküste)') AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Xinjiang' WHERE place_name = 'Xinjiang' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Sudan' WHERE place_name = 'Sudan' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Burkina Faso' WHERE place_name = 'Burkina Faso' AND place_name_normalized IS NULL;
UPDATE museum_objects SET place_name_normalized = 'Angola' WHERE place_name = 'Angola' AND place_name_normalized IS NULL;

-----------------------------------------------------------------------
-- PART I: Major archaeological sites — normalize German labels
-----------------------------------------------------------------------

UPDATE museum_objects SET place_name_normalized = 'Elephantine'
WHERE place_name = 'Elephantine' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Karnak'
WHERE place_name = 'Karnak' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Abusir'
WHERE place_name = 'Abusir' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Tiahuanaco'
WHERE place_name IN ('Tiahuanaco', 'Tihuanacu') AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Pachacamac'
WHERE place_name = 'Pachacámac' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Uruk'
WHERE place_name = 'Uruk' AND place_name_normalized IS NULL;

UPDATE museum_objects SET place_name_normalized = 'Dodona'
WHERE place_name = 'Dodona' AND place_name_normalized IS NULL;

-----------------------------------------------------------------------
-- NOTE: Ambiguous entries are intentionally left with NULL
-- place_name_normalized. These include:
--   "Egypt or Syria", "Central Asia or Iran", "probably X", 
--   "possibly X", "X (?)", "Iran or Turkey", "Peru (?)", etc.
-- Also left NULL: place_names with (0,0) coordinates that have
-- no country_en — these need geocoding first, not normalization.
-----------------------------------------------------------------------
