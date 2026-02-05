describe('Site Serving', () => {
  it('returns 404 for unknown subdomains', () => {
    cy.request({
      url: '/',
      headers: {
        Host: 'nonexistent-site-xyz.sites.megabyte.space',
      },
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.eq(404);
      expect(response.body.error).to.have.property('code', 'NOT_FOUND');
    });
  });
});

describe('Security Headers', () => {
  it('includes security headers in responses', () => {
    cy.request('/health').then((response) => {
      expect(response.headers).to.have.property('x-content-type-options', 'nosniff');
      expect(response.headers).to.have.property('x-frame-options', 'DENY');
      expect(response.headers).to.have.property('referrer-policy', 'strict-origin-when-cross-origin');
      expect(response.headers).to.have.property('strict-transport-security');
    });
  });
});
