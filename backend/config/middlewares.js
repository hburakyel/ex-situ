module.exports = [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:'],
          'img-src': ["'self'", 'data:', 'blob:', 'https://images.metmuseum.org', 'https://recherche.smb.museum', 'https://www.britishmuseum.org', 'https://upload.wikimedia.org'],
          'media-src': ["'self'", 'data:', 'blob:'],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  {
    name: 'strapi::cors',
    config: {
      origin: [
        process.env.FRONTEND_URL || 'http://localhost:3000',
        process.env.PUBLIC_URL || 'http://localhost:1337',
        'https://exsitu.app',
        'https://www.exsitu.app',
        'http://localhost:3000',
        'http://localhost:1337',
      ],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
      headers: ['Content-Type', 'Authorization', 'Origin', 'Accept', 'X-Requested-With'],
      credentials: true,
    },
  },
  // strapi::poweredBy intentionally removed — hides technology stack
  'strapi::query',
  {
    name: 'strapi::body',
    config: {
      formLimit: '1mb',
      jsonLimit: '1mb',
      textLimit: '1mb',
    },
  },
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
