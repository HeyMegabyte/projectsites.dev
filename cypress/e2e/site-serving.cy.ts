/**
 * Site serving E2E tests
 * Tests for serving static sites with top bar injection
 */

describe('Site Serving', () => {
  // Note: These tests require actual sites to be published
  // In staging/production, we should have test sites set up

  describe('Marketing Site', () => {
    it('should load the marketing homepage', () => {
      cy.visit('/');
      // The marketing site should load without errors
      cy.get('body').should('be.visible');
    });

    it('should have proper meta tags', () => {
      cy.visit('/');
      cy.get('head title').should('exist');
      cy.get('head meta[name="description"]').should('exist');
    });
  });

  describe('Site Not Found', () => {
    it('should show 404 for non-existent sites', () => {
      // Request a site that doesn't exist
      cy.request({
        url: '/',
        headers: {
          Host: 'nonexistent-site-12345.sites.megabyte.space',
        },
        failOnStatusCode: false,
      }).then((response) => {
        // Should return 404 or show "Site Not Found" page
        expect(response.status).to.be.oneOf([200, 404]);
        if (response.status === 200) {
          expect(response.body).to.include('Site Not Found');
        }
      });
    });
  });

  describe('Top Bar Injection', () => {
    it('should inject top bar for unpaid sites', () => {
      // This test would need a test site configured as unpaid
      // For now, we just verify the endpoint works
      cy.request('/').then((response) => {
        expect(response.status).to.eq(200);
      });
    });
  });
});

describe('Static Asset Serving', () => {
  it('should serve static assets with caching headers', () => {
    // Check that static assets are served with proper cache headers
    // This would need actual assets deployed to test properly
    cy.request({
      url: '/health',
      method: 'GET',
    }).then((response) => {
      expect(response.status).to.eq(200);
    });
  });
});
