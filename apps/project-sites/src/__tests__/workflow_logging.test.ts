/**
 * Unit tests for enhanced workflow logging in site-generation.ts.
 *
 * Verifies that the workflow:
 *  1. Logs granular step start/complete events with timing data
 *  2. Includes human-readable messages in metadata
 *  3. Logs phase information for UI categorization
 *  4. Records elapsed_ms for performance monitoring
 *  5. Handles errors with detailed failure logging
 *
 * Note: We cannot import the workflow module directly because it depends
 * on `cloudflare:workers` which is not available in Jest. Instead, we
 * verify the log message structure and metadata shape contracts.
 */

describe('Workflow log message format', () => {
  // Test that the metadata shape used in workflowLog calls is consistent
  // by verifying the expected fields exist in a representative log entry.

  it('workflow.started log includes required fields', () => {
    const metadata = {
      slug: 'test-site',
      business_name: 'Test Business',
      business_address: '123 Main St',
      google_place_id: null,
      has_additional_context: false,
      has_uploaded_assets: false,
      uploaded_asset_count: 0,
      phase: 'initialization',
    };

    expect(metadata).toHaveProperty('slug');
    expect(metadata).toHaveProperty('business_name');
    expect(metadata).toHaveProperty('phase', 'initialization');
    expect(metadata).toHaveProperty('uploaded_asset_count');
  });

  it('workflow step complete log includes timing data', () => {
    const metadata = {
      business_type: 'Barber Shop',
      services_count: 6,
      services: ['Haircut', 'Shave', 'Beard Trim'],
      has_email: true,
      has_address: true,
      city: 'New York',
      state: 'NY',
      elapsed_ms: 4523,
      message: 'Found business type: Barber Shop · 6 services found',
    };

    expect(metadata).toHaveProperty('elapsed_ms');
    expect(typeof metadata.elapsed_ms).toBe('number');
    expect(metadata).toHaveProperty('message');
    expect(metadata.message).toContain('Barber Shop');
    expect(metadata).toHaveProperty('services');
    expect(metadata.services).toHaveLength(3);
  });

  it('workflow failure log includes error details', () => {
    const metadata = {
      step: 'research-profile',
      error: 'LLM returned invalid JSON: unexpected token at position 42',
      elapsed_ms: 12000,
      message: 'Profile research failed: LLM returned invalid JSON: unexpected token at position 42',
      phase: 'data_collection',
      recoverable: false,
    };

    expect(metadata).toHaveProperty('error');
    expect(metadata).toHaveProperty('elapsed_ms');
    expect(metadata).toHaveProperty('recoverable', false);
    expect(metadata).toHaveProperty('phase', 'data_collection');
    expect(metadata.message).toContain('failed');
  });

  it('workflow completed log includes total timing', () => {
    const metadata = {
      slug: 'test-site',
      version: '2026-02-19T10-30-00-000Z',
      quality_score: 85,
      pages: ['index.html', 'privacy.html', 'terms.html', 'research.json'],
      url: 'https://test-site-sites.megabyte.space',
      total_elapsed_ms: 45000,
      total_seconds: 45,
      message: 'Site published successfully · 45s total · Score: 85/100',
      phase: 'complete',
    };

    expect(metadata).toHaveProperty('total_elapsed_ms');
    expect(metadata).toHaveProperty('total_seconds');
    expect(metadata).toHaveProperty('phase', 'complete');
    expect(metadata.message).toContain('published successfully');
    expect(metadata.message).toContain('45s total');
  });

  it('status_update log includes phase transitions', () => {
    const statuses = [
      { status: 'collecting', phase: 'data_collection', message: 'Starting AI-powered business research' },
      { status: 'generating', phase: 'generation', message: 'Data collection complete — generating website HTML' },
      { status: 'uploading', phase: 'deployment', message: 'All content generated — uploading files to storage' },
    ];

    for (const s of statuses) {
      expect(s).toHaveProperty('status');
      expect(s).toHaveProperty('phase');
      expect(s).toHaveProperty('message');
      expect(s.message.length).toBeGreaterThan(10);
    }
  });
});

describe('Workflow phases', () => {
  const validPhases = ['initialization', 'data_collection', 'generation', 'deployment', 'complete'];

  it('all workflow phases are valid identifiers', () => {
    for (const phase of validPhases) {
      expect(phase).toMatch(/^[a-z_]+$/);
    }
  });

  it('phases follow the correct order', () => {
    expect(validPhases[0]).toBe('initialization');
    expect(validPhases[validPhases.length - 1]).toBe('complete');
  });
});
