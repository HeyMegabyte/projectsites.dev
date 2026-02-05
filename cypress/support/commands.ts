/**
 * Cypress custom commands
 */

Cypress.Commands.add('checkHealth', () => {
  cy.request({
    url: '/health',
    method: 'GET',
    failOnStatusCode: false,
  }).then((response) => {
    expect(response.status).to.eq(200);
    expect(response.body).to.have.property('status', 'ok');
  });
});
