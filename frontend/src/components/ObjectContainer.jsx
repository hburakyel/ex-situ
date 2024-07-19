import React, { useEffect } from 'react';
import './ObjectContainer.css';

const ObjectContainer = ({ objects, onScroll, currentSize, onObjectClick }) => {
  useEffect(() => {
    const objectContainer = document.getElementById('objectContainer');
    if (objectContainer) {
      objectContainer.addEventListener('scroll', onScroll);
      return () => {
        objectContainer.removeEventListener('scroll', onScroll);
      };
    }
  }, [onScroll]);

  const containerHeight = currentSize === 'large' ? '100vh' : currentSize === 'small' ? '25vh' : '0vh';

  return (
    <div id="objectContainer" className="object-grid" style={{ height: containerHeight, overflowY: 'auto', width: '100vw' }}>
      {objects.map((obj, index) => (
        <div key={`${obj.id}-${index}`} className="object-card" onClick={() => onObjectClick(obj)}>
          <img src={obj.attributes.img_url} alt={obj.attributes.inventory_number} />
          <div className="object-info">
            <span>{obj.attributes.inventory_number}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ObjectContainer;
