/**
 * Health check E2E tests
 * Basic smoke tests for Project Sites Worker
 */

describe('Health Checks', () => {
  it('should return OK from health endpoint', () => {
    cy.request('/health').then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.have.property('status', 'ok');
      expect(response.body).to.have.property('timestamp');
    });
  });

  it('should return ready status with dependency checks', () => {
    cy.request('/health/ready').then((response) => {
      expect(response.status).to.be.oneOf([200, 503]);
      expect(response.body).to.have.property('status');
      expect(response.body).to.have.property('checks');
    });
  });

  it('should return live status', () => {
    cy.request('/health/live').then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.eq('OK');
    });
  });
});

describe('API Info', () => {
  it('should return API info from /api endpoint', () => {
    cy.request('/api').then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.have.property('name', 'Project Sites API');
      expect(response.body).to.have.property('version');
    });
  });

  it('should return config from /api/config', () => {
    cy.request('/api/config').then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.have.property('data');
      expect(response.body.data).to.have.property('environment');
    });
  });
});

describe('Security Headers', () => {
  it('should include security headers', () => {
    cy.request('/health').then((response) => {
      expect(response.headers).to.have.property('x-content-type-options', 'nosniff');
      expect(response.headers).to.have.property('x-frame-options', 'DENY');
    });
  });

  it('should include request ID in response', () => {
    cy.request('/api').then((response) => {
      expect(response.headers).to.have.property('x-request-id');
    });
  });
});
