Ex-Situ
Ex-Situ is a long-term web-based research and archive project that aims to create a cartographic visualization of the digital archives of museums in Europe and North America. The project focuses on the migration of artefacts from diverse cultures in Global South. By utilizing hyperlinks collected from various institutional websites and geolocating the migration of these artefacts, this project establishes connections not only to the physical migrations of artefacts but also to digital spaces like web domains.

The project reappropriates and exposes museums’ collection policies, contextualizing, and repractices for the digital age.

Project Creation Process
The creation of the Ex-Situ project repository involves three main steps:
1. Collection of Museum Objects: Gather data from museum APIs or public digital archives, focusing on artefacts categorized by museum as ethnological, Islamic, Egyptian, or from the Middle East, Anatolia, the Balkans, Latin America, and Africa. Specific datasets used include and aim to grow:
    * met_museum_objects_art_africa.json
    * smb_islamische_kunst_objects.json
    * ethnologisches_museum_objects.json
    * met_museum_objects_islamic_art.json
    * smb_agyptisches_papyrussammlung_objects.json
    * smb_antikensammlung_objects.json
    * smb_museum_asiatische_kunst_objects.json
    * smb_vorderasiatisches_museum_objects.json
2. Geolocating: Determine the origin locations of the artefacts based on the provided information, enabling accurate or approximate geolocation.
3. Displaying on the Map: Visualize the artefacts on an interactive map, showcasing their migration routes and current locations.

Disclaimer
All images and related content displayed on this website are hosted on third-party museum websites and are not stored on our servers. This project uses hyperlinks to reference these images, adhering to the terms and conditions set by the content owners. The use of images and information is solely for educational and non-commercial purposes, in compliance with the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0) license. Proper attribution is provided for all referenced materials. Users are encouraged to visit the original sources through the provided links for more information.

Project Structure
* frontend/: React frontend application
* backend/: Strapi backend application

Setup Instructions

Prerequisites
* Node.js
* npm
* PostgreSQL (for the backend)
* Nginx (for reverse proxy)

License
This project is licensed under the MIT License.
