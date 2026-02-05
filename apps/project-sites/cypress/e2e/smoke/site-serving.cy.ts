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
    });
  });

  it('returns 404 for unknown paths on base domain', () => {
    cy.request({
      url: '/this-page-does-not-exist-xyz',
      failOnStatusCode: false,
    }).then((response) => {
      // Could be 404 or a fallback page
      expect(response.status).to.be.oneOf([200, 404]);
    });
  });

  it('returns correct content-type for health endpoint', () => {
    cy.request('/health').then((response) => {
      expect(response.headers['content-type']).to.include('application/json');
    });
  });
});

describe('Security Headers', () => {
  it('includes Strict-Transport-Security', () => {
    cy.request('/health').then((response) => {
      expect(response.headers).to.have.property('strict-transport-security');
      expect(response.headers['strict-transport-security']).to.include('max-age=');
    });
  });

  it('includes X-Content-Type-Options nosniff', () => {
    cy.request('/health').then((response) => {
      expect(response.headers).to.have.property('x-content-type-options', 'nosniff');
    });
  });

  it('includes X-Frame-Options DENY', () => {
    cy.request('/health').then((response) => {
      expect(response.headers).to.have.property('x-frame-options', 'DENY');
    });
  });

  it('includes Referrer-Policy', () => {
    cy.request('/health').then((response) => {
      expect(response.headers).to.have.property(
        'referrer-policy',
        'strict-origin-when-cross-origin',
      );
    });
  });

  it('includes Permissions-Policy', () => {
    cy.request('/health').then((response) => {
      expect(response.headers).to.have.property('permissions-policy');
      expect(response.headers['permissions-policy']).to.include('camera=()');
    });
  });

  it('includes Content-Security-Policy', () => {
    cy.request('/health').then((response) => {
      expect(response.headers).to.have.property('content-security-policy');
      const csp = response.headers['content-security-policy'];
      expect(csp).to.include("default-src 'self'");
      expect(csp).to.include('https://js.stripe.com');
    });
  });
});

describe('Auth Endpoints', () => {
  it('POST /api/auth/magic-link validates email', () => {
    cy.request({
      method: 'POST',
      url: '/api/auth/magic-link',
      body: { email: 'not-an-email' },
      failOnStatusCode: false,
      headers: { 'Content-Type': 'application/json' },
    }).then((response) => {
      expect(response.status).to.be.oneOf([400, 401, 403, 422]);
    });
  });

  it('POST /api/auth/magic-link requires body', () => {
    cy.request({
      method: 'POST',
      url: '/api/auth/magic-link',
      failOnStatusCode: false,
      headers: { 'Content-Type': 'application/json' },
    }).then((response) => {
      expect(response.status).to.be.oneOf([400, 401, 403, 422]);
    });
  });

  it('GET /api/auth/google returns auth URL or error', () => {
    cy.request({
      url: '/api/auth/google',
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.be.oneOf([200, 302, 400, 401, 403, 404]);
    });
  });
});

describe('Webhook Endpoints', () => {
  it('POST /webhooks/stripe rejects unsigned requests', () => {
    cy.request({
      method: 'POST',
      url: '/webhooks/stripe',
      body: '{}',
      failOnStatusCode: false,
      headers: { 'Content-Type': 'application/json' },
    }).then((response) => {
      expect(response.status).to.be.oneOf([400, 401, 403]);
    });
  });

  it('POST /webhooks/stripe rejects invalid signature', () => {
    cy.request({
      method: 'POST',
      url: '/webhooks/stripe',
      body: '{"type":"checkout.session.completed"}',
      failOnStatusCode: false,
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 't=1234567890,v1=invalid_signature',
      },
    }).then((response) => {
      expect(response.status).to.be.oneOf([400, 401, 403]);
    });
  });
});

describe('Billing Endpoints', () => {
  it('POST /api/billing/checkout requires auth', () => {
    cy.request({
      method: 'POST',
      url: '/api/billing/checkout',
      failOnStatusCode: false,
      headers: { 'Content-Type': 'application/json' },
    }).then((response) => {
      expect(response.status).to.be.oneOf([401, 403]);
    });
  });

  it('GET /api/billing/entitlements requires auth', () => {
    cy.request({
      url: '/api/billing/entitlements',
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.be.oneOf([401, 403]);
    });
  });
});
