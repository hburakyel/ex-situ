// Local dev origins are only allowed outside production — combined with
// credentials: true they'd let any page served on those ports make
// authenticated cross-origin requests to the production API.
const devOrigins = process.env.NODE_ENV === 'production'
  ? []
  : ['http://localhost:3000', 'http://localhost:1337'];

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
        process.env.FRONTEND_URL,
        process.env.PUBLIC_URL,
        'https://exsitu.app',
        'https://www.exsitu.app',
        ...devOrigins,
      ].filter(Boolean),
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
