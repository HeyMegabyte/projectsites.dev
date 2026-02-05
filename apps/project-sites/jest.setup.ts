/**
 * Jest setup for Project Sites Worker tests
 */

// Extend expect with custom matchers if needed
// import '@testing-library/jest-dom';

// Mock console methods to reduce noise in tests
const originalConsole = { ...console };

beforeAll(() => {
  // Suppress console.log/info in tests unless DEBUG is set
  if (!process.env.DEBUG) {
    console.log = jest.fn();
    console.info = jest.fn();
  }
});

afterAll(() => {
  console.log = originalConsole.log;
  console.info = originalConsole.info;
});

// Global test timeout
jest.setTimeout(30000);
