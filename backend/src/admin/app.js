import { Earth } from '@strapi/icons';

const bootstrap = (app) => {
  app.addMenuLink({
    to: '/geo-correction',
    icon: Earth,
    intlLabel: {
      id: 'geo-correction.plugin.name',
      defaultMessage: 'Geo Correction',
    },
    permissions: [],
    async Component() {
      const { default: Component } = await import('./extensions/GeoCorrection');
      return { default: Component };
    },
  });
};

export default {
  config: {},
  bootstrap,
};
