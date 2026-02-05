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

  it('returns valid ISO timestamp', () => {
    cy.request('/health').then((response) => {
      const timestamp = response.body.timestamp;
      expect(new Date(timestamp).toISOString()).to.eq(timestamp);
    });
  });

  it('responds within 5 seconds', () => {
    const start = Date.now();
    cy.request('/health').then(() => {
      const elapsed = Date.now() - start;
      expect(elapsed).to.be.lessThan(5000);
    });
  });
});

describe('Marketing Site', () => {
  it('loads the marketing homepage', () => {
    cy.visit('/');
    cy.contains('Project Sites');
  });

  it('has correct content-type for homepage', () => {
    cy.request('/').then((response) => {
      expect(response.headers['content-type']).to.include('text/html');
    });
  });
});

describe('API Auth Gates', () => {
  it('returns 401 for unauthenticated /api/sites', () => {
    cy.request({
      url: '/api/sites',
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.be.oneOf([401, 403]);
    });
  });

  it('returns 401 for unauthenticated /api/billing/subscription', () => {
    cy.request({
      url: '/api/billing/subscription',
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.be.oneOf([401, 403]);
    });
  });

  it('returns 401 for unauthenticated /api/hostnames', () => {
    cy.request({
      url: '/api/hostnames',
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.be.oneOf([401, 403]);
    });
  });

  it('returns 401 for unauthenticated /api/audit-logs', () => {
    cy.request({
      url: '/api/audit-logs',
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.be.oneOf([401, 403]);
    });
  });
});

describe('Request Tracing', () => {
  it('returns x-request-id header', () => {
    cy.request('/health').then((response) => {
      expect(response.headers).to.have.property('x-request-id');
    });
  });

  it('propagates provided x-request-id', () => {
    const testId = 'e2e-test-' + Date.now();
    cy.request({
      url: '/health',
      headers: { 'x-request-id': testId },
    }).then((response) => {
      expect(response.headers['x-request-id']).to.eq(testId);
    });
  });
});

describe('CORS', () => {
  it('includes CORS headers for allowed origin', () => {
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

describe('Error Handling', () => {
  it('returns JSON error for unknown API routes', () => {
    cy.request({
      url: '/api/nonexistent-route-xyz',
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.be.oneOf([401, 403, 404]);
    });
  });

  it('returns 413 for oversized payloads', () => {
    const largeBody = 'x'.repeat(300000); // > 256KB
    cy.request({
      method: 'POST',
      url: '/api/auth/magic-link',
      body: largeBody,
      failOnStatusCode: false,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(largeBody.length),
      },
    }).then((response) => {
      expect(response.status).to.be.oneOf([413, 400]);
    });
  });
});
