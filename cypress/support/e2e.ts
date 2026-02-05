/**
 * Cypress E2E support file
 */

// Import commands
import './commands';

// Prevent uncaught exceptions from failing tests
Cypress.on('uncaught:exception', (err, runnable) => {
  // Log the error but don't fail the test
  console.error('Uncaught exception:', err.message);
  return false;
});

// Add custom assertions if needed
declare global {
  namespace Cypress {
    interface Chainable {
      /**
       * Custom command to check if Project Sites health endpoint is OK
       */
      checkHealth(): Chainable<void>;
    }
  }
}
