'use strict';

// Note: transpile-only mode is achieved via the `isolatedModules`
// TypeScript compiler option in each package's tsconfig.json, not here.
// Do NOT add `globals: {'ts-jest': ...}` to this preset -- that API is
// deprecated and removed in ts-jest v30. Do NOT add `rootDir` here --
// each package sets its own.

const { jestWorkers } = require('./concurrency');

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testRegex: '(?<!integration)\\.spec\\.ts$',
  maxWorkers: jestWorkers(),
  workerIdleMemoryLimit: '512MB',
};
