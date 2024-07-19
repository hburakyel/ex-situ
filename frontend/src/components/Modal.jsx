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
    linkUrl
  } = content;

  return (
    <div className="modal">
      <div className="modal-content">
        <span className="close" onClick={onClose}><i class="fa-solid fa-xmark"></i></span>
        <img src={imgUrl} alt={title} />
        <ul>
          <li><strong>Title:</strong> {title}</li>
          <li><strong>Time:</strong> {timeInfo}</li>
          <li><strong>From:</strong> {placeName}</li>
          <li><strong>To:</strong> {institutionPlace}</li>
          <li><strong>Institution:</strong> {institutionName}</li>
          <li><strong>Inventory Number:</strong> {inventoryNumber}</li>
          <li><strong>Source Link:</strong> <a href={linkUrl} target="_blank" rel="noopener noreferrer">{linkText}</a></li>
        </ul>
      </div>
    </div>
  );
};

export default Modal;
