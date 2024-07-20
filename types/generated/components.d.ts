import type { Schema, Attribute } from '@strapi/strapi';

export interface ObjectLinksObjectLinkInfo extends Schema.Component {
  collectionName: 'components_object_links_object_link_infos';
  info: {
    displayName: 'object_link_info';
    description: '';
  };
  attributes: {
    link_text: Attribute.Text;
    link_display: Attribute.String;
  };
}

export interface TimeEndTimeInfo extends Schema.Component {
  collectionName: 'components_time_end_time_infos';
  info: {
    displayName: 'time_info';
  };
  attributes: {
    time_name: Attribute.String;
  };
}

export interface TimeNameTimeInfo extends Schema.Component {
  collectionName: 'components_time_name_time_infos';
  info: {
    displayName: 'time_info';
    description: '';
  };
  attributes: {
    time_name: Attribute.String;
    time_start: Attribute.String;
    time_end: Attribute.String;
  };
}

export interface TimeStartTimeInfo extends Schema.Component {
  collectionName: 'components_time_start_time_infos';
  info: {
    displayName: 'time_info';
  };
  attributes: {
    time_info: Attribute.Component<'time-end.time-info'>;
  };
}

declare module '@strapi/types' {
  export module Shared {
    export interface Components {
      'object-links.object-link-info': ObjectLinksObjectLinkInfo;
      'time-end.time-info': TimeEndTimeInfo;
      'time-name.time-info': TimeNameTimeInfo;
      'time-start.time-info': TimeStartTimeInfo;
    }
  }
}
