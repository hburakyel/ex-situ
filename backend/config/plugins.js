module.exports = () => ({
  upload: {
    config: {
      // Restrict file uploads — this was an RCE attack vector
      sizeLimit: 5 * 1024 * 1024, // 5MB max
      breakpoints: {
        xlarge: 1920,
        large: 1000,
        medium: 750,
        small: 500,
        xsmall: 64,
      },
    },
  },
  // Disable user registration — no public signups
  'users-permissions': {
    config: {
      register: {
        allowedFields: [],
      },
      jwt: {
        expiresIn: '1d',
      },
    },
  },
});
