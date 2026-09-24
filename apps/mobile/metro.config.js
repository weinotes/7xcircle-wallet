const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// The shared packages use NodeNext-style ".js" specifiers in TypeScript
// source. Metro needs those specifiers mapped back to TS files.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.endsWith('.js')) {
    try {
      return context.resolveRequest(
        context,
        moduleName.slice(0, -3),
        platform,
      );
    } catch {
      // Preserve Metro's normal error and resolution behavior.
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
