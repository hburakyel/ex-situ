import React from 'react';
import './Modal.css';

const Modal = ({ isOpen, onClose, content }) => {
  if (!isOpen || !content) return null;

  const {
    title,
    imgUrl,
    timeInfo,
    institutionPlace,
    institutionName,
    placeName,
    inventoryNumber,
    linkText,
  } = content;

  return (
    <div className="modal">
      <div className="modal-content">
        <span className="close" onClick={onClose}><i class="fa-solid fa-xmark"></i></span>
        
        <div className='image-tab'><img src={imgUrl} alt={title} />
        </div>
        <div className='info-tab'>
        
        <div className="cell">
  <span className="field-name">Title</span>
</div>
<div className="cell-content">
  <span>{title}</span>
</div>

<div className="cell">
  <span className="field-name">Time</span>
</div>
<div className="cell-content">
  <span>{timeInfo}</span>
</div>

<div className="cell">
  <span className="field-name">From</span>
</div>
<div className="cell-content">
  <span>{placeName}</span>
</div>

<div className="cell">
  <span className="field-name">To</span>
</div>
<div className="cell-content">
  <span>{institutionPlace}</span>
</div>

<div className="cell">
  <span className="field-name">Institution</span>
</div>
<div className="cell-content">
  <span>{institutionName}</span>
</div>

<div className="cell">
  <span className="field-name">Inventory Number</span>
</div>
<div className="cell-content">
  <span>{inventoryNumber}</span>
</div>

<div className="cell">
  <span className="field-name">Source Link</span>
</div>
<div className="cell-content">
  <span><a href={linkText} target="_blank" rel="noopener noreferrer">{linkText}</a></span>
</div>

      </div>
    </div>
    </div>
  );
};

export default Modal;
