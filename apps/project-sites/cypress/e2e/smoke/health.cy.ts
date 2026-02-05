describe('Health Check', () => {
  it('returns healthy status', () => {
    cy.request('/health').then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.have.property('status');
      expect(response.body.status).to.be.oneOf(['ok', 'degraded']);
      expect(response.body).to.have.property('version');
      expect(response.body).to.have.property('environment');
      expect(response.body).to.have.property('timestamp');
    });
  });

  it('includes dependency checks', () => {
    cy.request('/health').then((response) => {
      expect(response.body).to.have.property('checks');
    });
  });
});

describe('Marketing Site', () => {
  it('loads the marketing homepage', () => {
    cy.visit('/');
    cy.contains('Project Sites');
  });
});

describe('API Health', () => {
  it('returns 401 for unauthenticated API calls', () => {
    cy.request({
      url: '/api/sites',
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.be.oneOf([401, 403]);
    });
  });

  it('returns CORS headers', () => {
    cy.request({
      url: '/health',
      headers: {
        Origin: 'https://sites.megabyte.space',
      },
    }).then((response) => {
      expect(response.headers).to.have.property('x-request-id');
    });
  });
});
