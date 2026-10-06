const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    unstable_enablePackageExports: true,
    unstable_conditionNames: ['require', 'react-native', 'default'],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
