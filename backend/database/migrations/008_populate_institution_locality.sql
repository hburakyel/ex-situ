-- Migration 008: Populate institution_city_en and institution_country_en
-- from the existing institution_place field.
--
-- institution_place stores the city name of the collecting institution.
-- This migration maps known city names to (city_en, country_en) pairs.
-- Records not matched by the static mapping are handled by the companion
-- script: scripts/populate-institution-locality.js
--
-- Safe to re-run: only updates rows where the target columns are NULL.

-- -----------------------------------------------------------------------
-- Static mapping: major collecting cities → (city_en, country_en)
-- -----------------------------------------------------------------------
UPDATE museum_objects
SET
  institution_city_en    = mapping.city_en,
  institution_country_en = mapping.country_en
FROM (VALUES
  -- Germany
  ('Berlin',          'Berlin',           'Germany'),
  ('München',         'Munich',           'Germany'),
  ('Munich',          'Munich',           'Germany'),
  ('Hamburg',         'Hamburg',          'Germany'),
  ('Frankfurt',       'Frankfurt',        'Germany'),
  ('Köln',            'Cologne',          'Germany'),
  ('Cologne',         'Cologne',          'Germany'),
  ('Stuttgart',       'Stuttgart',        'Germany'),
  ('Leipzig',         'Leipzig',          'Germany'),
  ('Dresden',         'Dresden',          'Germany'),
  ('Heidelberg',      'Heidelberg',       'Germany'),
  ('Bonn',            'Bonn',             'Germany'),

  -- United Kingdom
  ('London',          'London',           'United Kingdom'),
  ('Oxford',          'Oxford',           'United Kingdom'),
  ('Cambridge',       'Cambridge',        'United Kingdom'),
  ('Edinburgh',       'Edinburgh',        'United Kingdom'),
  ('Glasgow',         'Glasgow',          'United Kingdom'),
  ('Manchester',      'Manchester',       'United Kingdom'),
  ('Liverpool',       'Liverpool',        'United Kingdom'),
  ('Bristol',         'Bristol',          'United Kingdom'),

  -- United States
  ('New York',        'New York',         'United States'),
  ('Washington',      'Washington D.C.',  'United States'),
  ('Washington D.C.', 'Washington D.C.',  'United States'),
  ('Chicago',         'Chicago',          'United States'),
  ('Los Angeles',     'Los Angeles',      'United States'),
  ('Boston',          'Boston',           'United States'),
  ('Philadelphia',    'Philadelphia',     'United States'),
  ('Houston',         'Houston',          'United States'),
  ('San Francisco',   'San Francisco',    'United States'),
  ('Minneapolis',     'Minneapolis',      'United States'),
  ('Cleveland',       'Cleveland',        'United States'),
  ('Detroit',         'Detroit',          'United States'),
  ('Seattle',         'Seattle',          'United States'),
  ('Denver',          'Denver',           'United States'),
  ('Atlanta',         'Atlanta',          'United States'),
  ('Dallas',          'Dallas',           'United States'),
  ('Kansas City',     'Kansas City',      'United States'),
  ('St. Louis',       'St. Louis',        'United States'),
  ('Cincinnati',      'Cincinnati',       'United States'),
  ('Indianapolis',    'Indianapolis',     'United States'),
  ('New Haven',       'New Haven',        'United States'),
  ('Princeton',       'Princeton',        'United States'),
  ('Cambridge, MA',   'Cambridge',        'United States'),

  -- France
  ('Paris',           'Paris',            'France'),
  ('Lyon',            'Lyon',             'France'),
  ('Marseille',       'Marseille',        'France'),
  ('Bordeaux',        'Bordeaux',         'France'),
  ('Strasbourg',      'Strasbourg',       'France'),
  ('Toulouse',        'Toulouse',         'France'),
  ('Nice',            'Nice',             'France'),

  -- Netherlands
  ('Amsterdam',       'Amsterdam',        'Netherlands'),
  ('Rotterdam',       'Rotterdam',        'Netherlands'),
  ('Leiden',          'Leiden',           'Netherlands'),
  ('The Hague',       'The Hague',        'Netherlands'),
  ('Den Haag',        'The Hague',        'Netherlands'),
  ('Utrecht',         'Utrecht',          'Netherlands'),
  ('Groningen',       'Groningen',        'Netherlands'),

  -- Belgium
  ('Brussels',        'Brussels',         'Belgium'),
  ('Bruxelles',       'Brussels',         'Belgium'),
  ('Antwerp',         'Antwerp',          'Belgium'),
  ('Antwerpen',       'Antwerp',          'Belgium'),
  ('Ghent',           'Ghent',            'Belgium'),
  ('Gent',            'Ghent',            'Belgium'),
  ('Bruges',          'Bruges',           'Belgium'),
  ('Tervuren',        'Tervuren',         'Belgium'),

  -- Austria
  ('Vienna',          'Vienna',           'Austria'),
  ('Wien',            'Vienna',           'Austria'),
  ('Graz',            'Graz',             'Austria'),
  ('Salzburg',        'Salzburg',         'Austria'),
  ('Linz',            'Linz',             'Austria'),

  -- Switzerland
  ('Basel',           'Basel',            'Switzerland'),
  ('Zurich',          'Zurich',           'Switzerland'),
  ('Zürich',          'Zurich',           'Switzerland'),
  ('Geneva',          'Geneva',           'Switzerland'),
  ('Genève',          'Geneva',           'Switzerland'),
  ('Bern',            'Bern',             'Switzerland'),

  -- Italy
  ('Rome',            'Rome',             'Italy'),
  ('Roma',            'Rome',             'Italy'),
  ('Milan',           'Milan',            'Italy'),
  ('Milano',          'Milan',            'Italy'),
  ('Florence',        'Florence',         'Italy'),
  ('Firenze',         'Florence',         'Italy'),
  ('Venice',          'Venice',           'Italy'),
  ('Venezia',         'Venice',           'Italy'),
  ('Turin',           'Turin',            'Italy'),
  ('Torino',          'Turin',            'Italy'),
  ('Naples',          'Naples',           'Italy'),
  ('Napoli',          'Naples',           'Italy'),
  ('Bologna',         'Bologna',          'Italy'),

  -- Spain
  ('Madrid',          'Madrid',           'Spain'),
  ('Barcelona',       'Barcelona',        'Spain'),
  ('Seville',         'Seville',          'Spain'),
  ('Sevilla',         'Seville',          'Spain'),
  ('Valencia',        'Valencia',         'Spain'),
  ('Bilbao',          'Bilbao',           'Spain'),

  -- Portugal
  ('Lisbon',          'Lisbon',           'Portugal'),
  ('Lisboa',          'Lisbon',           'Portugal'),
  ('Porto',           'Porto',            'Portugal'),

  -- Russia
  ('Moscow',          'Moscow',           'Russia'),
  ('Moskva',          'Moscow',           'Russia'),
  ('St. Petersburg',  'St. Petersburg',   'Russia'),
  ('Saint Petersburg','St. Petersburg',   'Russia'),

  -- Japan
  ('Tokyo',           'Tokyo',            'Japan'),
  ('Osaka',           'Osaka',            'Japan'),
  ('Kyoto',           'Kyoto',            'Japan'),

  -- Canada
  ('Toronto',         'Toronto',          'Canada'),
  ('Montreal',        'Montreal',         'Canada'),
  ('Vancouver',       'Vancouver',        'Canada'),
  ('Ottawa',          'Ottawa',           'Canada'),

  -- Australia
  ('Sydney',          'Sydney',           'Australia'),
  ('Melbourne',       'Melbourne',        'Australia'),
  ('Canberra',        'Canberra',         'Australia'),

  -- Denmark
  ('Copenhagen',      'Copenhagen',       'Denmark'),
  ('København',       'Copenhagen',       'Denmark'),

  -- Sweden
  ('Stockholm',       'Stockholm',        'Sweden'),
  ('Gothenburg',      'Gothenburg',       'Sweden'),

  -- Norway
  ('Oslo',            'Oslo',             'Norway'),

  -- Finland
  ('Helsinki',        'Helsinki',         'Finland'),

  -- Poland
  ('Warsaw',          'Warsaw',           'Poland'),
  ('Warszawa',        'Warsaw',           'Poland'),
  ('Krakow',          'Kraków',           'Poland'),
  ('Kraków',          'Kraków',           'Poland'),

  -- Czech Republic
  ('Prague',          'Prague',           'Czech Republic'),
  ('Praha',           'Prague',           'Czech Republic'),

  -- Hungary
  ('Budapest',        'Budapest',         'Hungary'),

  -- Romania
  ('Bucharest',       'Bucharest',        'Romania'),

  -- South Africa
  ('Cape Town',       'Cape Town',        'South Africa'),
  ('Johannesburg',    'Johannesburg',     'South Africa'),

  -- Egypt
  ('Cairo',           'Cairo',            'Egypt'),

  -- China
  ('Beijing',         'Beijing',          'China'),
  ('Shanghai',        'Shanghai',         'China'),

  -- India
  ('New Delhi',       'New Delhi',        'India'),
  ('Mumbai',          'Mumbai',           'India'),
  ('Kolkata',         'Kolkata',          'India')

) AS mapping(institution_place_key, city_en, country_en)
WHERE museum_objects.institution_place = mapping.institution_place_key
  AND (museum_objects.institution_city_en    IS NULL
    OR museum_objects.institution_country_en IS NULL)
  AND museum_objects.published_at IS NOT NULL;
