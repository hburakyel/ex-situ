import React, { useState, useEffect } from 'react';
import './Filter.css';
import SearchBar from './SearchBar';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronUp, faChevronDown } from '@fortawesome/free-solid-svg-icons';

const Filter = ({ locationInfo, onZoom, filterVisible, onSearch }) => {
  const [openSections, setOpenSections] = useState({
    From: true,
    To: true,
    Institution: true,
  });

  useEffect(() => {
    if (filterVisible) {
      setOpenSections({
        From: true,
        To: true,
        Institution: true,
      });
    }
  }, [filterVisible]);

  const toggleSection = (section) => {
    setOpenSections((prevState) => ({
      ...prevState,
      [section]: !prevState[section],
    }));
  };

  return (
    <div id="locationInfoFooter" className="filter p-4 bg-white rounded-lg shadow-md">
      <SearchBar onSearch={onSearch} />
      <div className="table">
               {/* From Section */}
               <div className="cell" onClick={() => toggleSection('From')}>
          <span className="field-name">From</span>
          <span>
            <FontAwesomeIcon icon={openSections['From'] ? faChevronUp : faChevronDown} />
          </span>
        </div>
        {openSections['From'] && (
          <div className="cell-content">
            {locationInfo.fromPlaces.split(', ').map((place, index) => {
              const [name, count] = place.split(' (');
              return (
                <div key={index} onClick={() => onZoom('from', name)}>
                  {name}
                  {count && <span className="field-name"> {count.replace(')', '')}</span>}
                </div>
              );
            })}
          </div>
        )}

        {/* To Section */}
        <div className="cell" onClick={() => toggleSection('To')}>
          <span className="field-name">To</span>
          <span>
            <FontAwesomeIcon icon={openSections['To'] ? faChevronUp : faChevronDown} />
          </span>
        </div>
        {openSections['To'] && (
          <div className="cell-content">
            {locationInfo.toPlaces.split(', ').map((place, index) => (
              <div key={index} onClick={() => onZoom('to', place)}>{place}</div>
            ))}
          </div>
        )}

        {/* Institution Section */}
        <div className="cell" onClick={() => toggleSection('Institution')}>
          <span className="field-name font-medium">Institution</span>
          <span>
            <FontAwesomeIcon icon={openSections['Institution'] ? faChevronUp : faChevronDown} />
          </span>
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
