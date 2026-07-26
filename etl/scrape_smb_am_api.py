import requests
import json
import time
import os

from smb_event_selection import select_origin_event

def fetch_objects(query_string, current_position, max_results):
    url = 'https://smb.museum-digital.de/json/objects'
    params = {
        's': query_string,
        'startwert': current_position,
        'gbreitenat': max_results,
        'navlang': 'en'
    }
    response = requests.get(url, params=params)
    if response.status_code == 200:
        return response.json()
    else:
        print(f"Error fetching objects: {response.status_code}")
        return []

def fetch_object_details(object_id):
    url = f'https://smb.museum-digital.de/json/object/{object_id}'
    response = requests.get(url)
    if response.status_code == 200:
        object_details = response.json()
        # Fetch object links
        object_links = fetch_object_links(object_id)
        if object_links is not None:
            object_details['object_links'] = object_links
        return object_details
    else:
        print(f"Error fetching object details for object {object_id}: {response.status_code}")
        return {}

def fetch_object_links(object_id):
    url = f'https://smb.museum-digital.de/json/object/{object_id}/object_links'
    response = requests.get(url)
    if response.status_code == 200:
        return response.json()
    else:
        print(f"Error fetching object links for object {object_id}: {response.status_code}")
        return None

def save_progress(data, filename='up_smb_antikensammlung_objects.json'):
    with open(filename, 'w') as json_file:
        json.dump(data, json_file, indent=4)

def load_progress(filename='up_smb_antikensammlung_objects.json'):
    if os.path.exists(filename):
        try:
            with open(filename, 'r') as json_file:
                return json.load(json_file)
        except json.JSONDecodeError as e:
            print(f"Error loading JSON file {filename}: {e}")
            return []
    return []

def main():
    query_string = "institution:10"  # Search for objects from Antikensammlung
    all_objects = load_progress()  # Load previous progress
    fetched_object_ids = {obj['object_id'] for obj in all_objects}
    max_results = 50  # Fetch 50 objects at a time
    save_interval = 100  # Save progress every 100 objects

    current_position = 0

    print(f"Fetching objects for Antikensammlung with query: {query_string}")

    while True:
        objects = fetch_objects(query_string, current_position, max_results)
        if not objects:
            break

        for obj in objects:
            object_id = obj['objekt_id']
            if object_id in fetched_object_ids:
                continue  # Skip already fetched objects

            print(f"Fetching details for object {object_id}")
            object_details = fetch_object_details(object_id)
            
            if not object_details:
                continue
            
            # Extract place data — event-type-aware (see smb_event_selection.py):
            # prefers a genuine findspot ("Gefunden") event over a production
            # ("Hergestellt"/"Gemalt") one, and never uses Gesammelt/Aufgenommen/
            # etc. as origin. Also folds in the 0/0 "no known coordinate" guard.
            object_events = object_details.get('object_events', [])
            origin = select_origin_event(object_events)
            place_name = origin['place_name'] if origin['place_name'] is not None else 'N/A'
            place_latitude = origin['latitude'] if origin['latitude'] is not None else 'N/A'
            place_longitude = origin['longitude'] if origin['longitude'] is not None else 'N/A'

            # Extract time data
            if object_events:
                time_data = object_events[0].get('time', {})
                time_name = time_data.get('time_name', 'N/A')
                time_start = time_data.get('time_start', 'N/A')
                time_end = time_data.get('time_end', 'N/A')
            else:
                time_name = 'N/A'
                time_start = 'N/A'
                time_end = 'N/A'

            # Extract object links from fetched details
            object_links = object_details.get('object_links', [])

            # acquisition_year: look for an acquisition event (event_type_id == 1
            # in museum-digital = Herstellung/acquisition); fall back to None.
            acquisition_year = None
            for evt in object_events:
                evt_type = str(evt.get('event_type_id', ''))
                t = evt.get('time', {})
                t_start = t.get('time_start', '')
                if evt_type == '1' and t_start and str(t_start).isdigit():
                    acquisition_year = int(str(t_start)[:4])
                    break

            object_data = {
                'object_id': obj['objekt_id'],
                'title': obj['objekt_name'],
                'img_url': f"https://smb.museum-digital.de/data/smb/resources/images/{obj.get('image', '')}",
                'latitude': place_latitude,
                'longitude': place_longitude,
                'institution_place': 'Berlin',
                'object_date': time_name if time_name != 'N/A' else None,
                'acquisition_year': acquisition_year,
                'source_link': f"https://smb.museum-digital.de/object/{object_id}",
                'institution_latitude': 52.519,
                'institution_longitude': 13.398,
                'institution_name': 'Antikensammlung',
                'place_name': place_name,
                'origin_event_type_id': origin['event_type_id'],
                'origin_event_type_en': origin['event_type_en'],
                'origin_is_findspot': origin['is_findspot'],
                'origin_person_name': origin['person_name'],
                'time': {
                    'time_name': time_name if time_name != 'N/A' else None,
                    'time_start': time_start if time_start != 'N/A' else None,
                    'time_end': time_end if time_end != 'N/A' else None
                },
                'inventory_number': obj.get('objekt_inventarnr', 'N/A'),
                'object_links': object_links
            }

            all_objects.append(object_data)
            fetched_object_ids.add(object_id)

            if len(all_objects) % save_interval == 0:
                print(f"Saving progress: {len(all_objects)} objects fetched")
                save_progress(all_objects)

        current_position += max_results

        # Sleep to avoid hitting the rate limit
        time.sleep(1)

    save_progress(all_objects)
    print(f"Saved {len(all_objects)} objects to up_smb_antikensammlung_objects.json")

if __name__ == '__main__':
    main()
