const { withAppDelegate, withInfoPlist } = require('@expo/config-plugins');

/**
 * Injects Google Maps iOS SDK initialization into AppDelegate.mm.
 * Required for react-native-maps with Google Maps backend on iOS.
 * Supports Expo SDK 51 AppDelegate format.
 */
const withGoogleMapsIOS = (config, { apiKey } = {}) => {
  if (!apiKey) return config;

  // Add key to Info.plist (used by some SDK paths)
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.GMSApiKey = apiKey;
    return cfg;
  });

  // Inject [GMSServices provideAPIKey:] into AppDelegate.mm
  config = withAppDelegate(config, (cfg) => {
    let src = cfg.modResults.contents;

    // Add import after the last existing #import line if not already present
    if (!src.includes('GoogleMaps')) {
      src = src.replace(
        /#import "AppDelegate\.h"/,
        '#import "AppDelegate.h"\n#import <GoogleMaps/GoogleMaps.h>',
      );
    }

    // Insert provideAPIKey before self.moduleName assignment (Expo SDK 51 format)
    if (!src.includes('provideAPIKey')) {
      // Try Expo SDK 51+ style: self.moduleName = @"main"
      if (src.includes('self.moduleName')) {
        src = src.replace(
          /(\s*)(self\.moduleName\s*=)/,
          `$1[GMSServices provideAPIKey:@"${apiKey}"];\n$1$2`,
        );
      } else {
        // Fallback: insert after opening brace of didFinishLaunching
        src = src.replace(
          /(didFinishLaunchingWithOptions[^{]*\{)/,
          `$1\n  [GMSServices provideAPIKey:@"${apiKey}"];`,
        );
      }
    }

    cfg.modResults.contents = src;
    return cfg;
  });

  return config;
};

module.exports = withGoogleMapsIOS;
