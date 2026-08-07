'use strict';

/**
 * Print one stable environment preamble before Jest starts any test suite.
 * This keeps the diagnostic requested during review independent of Jest's
 * test-file scheduling order.
 */
module.exports = async function diagnosticEnvironmentCheck() {
  const hasUrlSearchParams = typeof global.URLSearchParams !== 'undefined';

  console.log('--- JEST DIAGNOSTIC LOG ---');
  console.log('Process Node Version:', process.version);
  console.log('Global Object Keys count:', Object.keys(global).length);
  console.log('Is window defined?', typeof window !== 'undefined');
  console.log('Is URLSearchParams on global?', hasUrlSearchParams);
  console.log('---------------------------');

  if (!hasUrlSearchParams) {
    throw new Error('The test environment must provide URLSearchParams.');
  }
};
