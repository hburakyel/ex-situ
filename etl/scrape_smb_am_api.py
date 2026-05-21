import requests
import json
import time
import os

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
            
            # Extract place data
            object_events = object_details.get('object_events', [])
            if object_events:
                place_data = object_events[0].get('place', {})
                place_name = place_data.get('place_name', 'N/A')
                place_latitude = place_data.get('place_latitude', 'N/A')
                place_longitude = place_data.get('place_longitude', 'N/A')
            else:
                place_name = 'N/A'
                place_latitude = 'N/A'
                place_longitude = 'N/A'

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

            object_data = {
                'object_id': obj['objekt_id'],
                'title': obj['objekt_name'],
                'img_url': f"https://smb.museum-digital.de/data/smb/resources/images/{obj.get('image', '')}",
                'latitude': place_latitude,
                'longitude': place_longitude,
                'institution_place': 'Berlin',
                'date_captured': obj.get('objekt_erfasst_am', 'N/A'),
                'source_link': f"https://smb.museum-digital.de/object/{object_id}",
                'institution_latitude': 52.519,
                'institution_longitude': 13.398,
                'institution_name': 'Antikensammlung',
                'place_name': place_name,
                'time': {
                    'time_name': time_name,
                    'time_start': time_start,
                    'time_end': time_end
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
