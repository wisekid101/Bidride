const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch all packages in the monorepo so Metro picks up changes
config.watchFolders = [monorepoRoot];

// Resolve from app node_modules first, then root — handles pnpm hoisting gaps
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Use symlink paths instead of real .pnpm store paths — fixes HMR crash where
// Metro tries to resolve the .pnpm real path as a relative module from the app root.
config.resolver.unstable_enableSymlinks = true;

// Pin react and react-native to the app's versions (18.2.0 + RN 0.74.5).
// Root node_modules has React 18.3.1 (for Next.js admin); pnpm store packages
// (expo-keep-awake, stripe, etc.) resolve React from the root and end up with
// a different instance than the renderer, causing "Invalid hook call" at startup.
// resolveRequest intercepts ALL require('react') calls monorepo-wide.
const appReact = path.resolve(projectRoot, 'node_modules/react');
const appReactNative = path.resolve(projectRoot, 'node_modules/react-native');

config.resolver.extraNodeModules = {
  'react': appReact,
  'react-native': appReactNative,
  'react/jsx-runtime': path.resolve(appReact, 'jsx-runtime'),
  'react/jsx-dev-runtime': path.resolve(appReact, 'jsx-dev-runtime'),
};

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react' || moduleName === 'react/jsx-runtime' || moduleName === 'react/jsx-dev-runtime') {
    const sub = moduleName.slice('react'.length); // '' | '/jsx-runtime' | '/jsx-dev-runtime'
    return { type: 'sourceFile', filePath: require.resolve(appReact + sub) };
  }
  if (moduleName === 'react-native') {
    return { type: 'sourceFile', filePath: require.resolve(path.resolve(appReactNative, 'index.js')) };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
