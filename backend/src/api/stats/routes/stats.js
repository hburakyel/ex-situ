'use strict';

module.exports = {
  routes: [
    {
      method: "GET",
      path: "/stats",
      handler: "stats.find",
      config: {
        auth: false, // Allow public access
      },
    },
  ],
};
