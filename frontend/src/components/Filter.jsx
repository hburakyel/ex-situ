import React, { useState } from 'react';
import './Filter.css';

const Filter = ({ locationInfo, onZoom }) => {
  const [openSections, setOpenSections] = useState({});

  const toggleSection = (section) => {
    setOpenSections((prevState) => ({
      ...prevState,
      [section]: !prevState[section],
    }));
  };

  return (
    <div id="locationInfoFooter" className="filter p-4 bg-white rounded-lg shadow-md">
      <div className="table">
        <div className="cell" onClick={() => toggleSection('Ex-Situ')}>
          <span className="field-name">Ex-Situ</span>
          <span>{openSections['Ex-Situ'] ? '▴' : '▾'}</span>
        </div>
        {openSections['Ex-Situ'] && (
          <div className="cell-content">
            <span id="locationInfo" className="text-lg font-bold">{locationInfo.location}</span>
          </div>
        )}

        <div className="cell" onClick={() => toggleSection('Arcs')}>
          <span className="field-name font-medium">Arcs</span>
          <span>{openSections['Arcs'] ? '▴' : '▾'}</span>
        </div>
        {openSections['Arcs'] && (
          <div className="cell-content">
            <span id="locationInfoArcs">{locationInfo.arcCount} Arcs</span>
          </div>
        )}

        <div className="cell" onClick={() => toggleSection('Artefacts')}>
          <span className="field-name font-medium">Artefacts</span>
          <span>{openSections['Artefacts'] ? '▴' : '▾'}</span>
        </div>
        {openSections['Artefacts'] && (
          <div className="cell-content">
            <span id="locationInfoArtefacts">{locationInfo.objectCount} Artefacts</span>
          </div>
        )}

        <div className="cell" onClick={() => toggleSection('From')}>
          <span className="field-name font-medium">From</span>
          <span>{openSections['From'] ? '▴' : '▾'}</span>
        </div>
        {openSections['From'] && (
          <div className="cell-content">
            {locationInfo.fromPlaces.split(', ').map((place, index) => (
              <div key={index} onClick={() => onZoom('from', place.split(' (')[0])}>{place}</div>
            ))}
          </div>
        )}

        <div className="cell" onClick={() => toggleSection('To')}>
          <span className="field-name font-medium">To</span>
          <span>{openSections['To'] ? '▴' : '▾'}</span>
        </div>
        {openSections['To'] && (
          <div className="cell-content">
            {locationInfo.toPlaces.split(', ').map((place, index) => (
              <div key={index} onClick={() => onZoom('to', place)}>{place}</div>
            ))}
          </div>
        )}

        <div className="cell" onClick={() => toggleSection('Institution')}>
          <span className="field-name font-medium">Institution</span>
          <span>{openSections['Institution'] ? '▴' : '▾'}</span>
        </div>
        {openSections['Institution'] && (
          <div className="cell-content">
            {locationInfo.institutionNames.split(', ').map((name, index) => (
              <div key={index} onClick={() => onZoom('institution', name)}>{name}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Filter;
