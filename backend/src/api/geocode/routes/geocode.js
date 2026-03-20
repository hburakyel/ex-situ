'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/geocode',
      handler: 'geocode.find',
      config: {
        auth: false,
      },
    },
  ],
};
