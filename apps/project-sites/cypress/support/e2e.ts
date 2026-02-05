// Cypress support file
// Add custom commands and global configuration here

Cypress.on('uncaught:exception', () => {
  // Prevent Cypress from failing on uncaught exceptions from the app
  return false;
});
