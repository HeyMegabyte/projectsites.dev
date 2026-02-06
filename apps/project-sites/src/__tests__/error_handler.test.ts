import { AppError, badRequest, unauthorized, notFound, internalError } from '@project-sites/shared';
import { ZodError, z } from 'zod';

describe('AppError integration', () => {
  it('serializes to standard error envelope', () => {
    const err = badRequest('Invalid input', { field: 'email' });
    const json = err.toJSON();

    expect(json).toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid input',
        request_id: undefined,
        details: { field: 'email' },
      },
    });
  });

  it('has correct HTTP status codes', () => {
    expect(badRequest('test').statusCode).toBe(400);
    expect(unauthorized().statusCode).toBe(401);
    expect(notFound().statusCode).toBe(404);
    expect(internalError().statusCode).toBe(500);
  });

  it('includes request_id when provided', () => {
    const err = new AppError({
      code: 'BAD_REQUEST',
      message: 'test',
      statusCode: 400,
      requestId: 'req-abc-123',
    });
    expect(err.toJSON().error.request_id).toBe('req-abc-123');
  });

  it('preserves error cause chain', () => {
    const original = new Error('DB connection failed');
    const wrapped = internalError('Service unavailable', original);
    expect(wrapped.cause).toBe(original);
  });
});

describe('ZodError handling', () => {
  it('produces structured validation errors', () => {
    const schema = z.object({
      email: z.string().email(),
      age: z.number().min(0),
    });

    try {
      schema.parse({ email: 'not-email', age: -1 });
    } catch (err) {
      expect(err).toBeInstanceOf(ZodError);
      const zodErr = err as ZodError;
      expect(zodErr.issues.length).toBeGreaterThanOrEqual(2);
      expect(zodErr.issues[0]!.path).toContain('email');
    }
  });

  it('can be mapped to API error format', () => {
    const schema = z.object({ name: z.string().min(1) });

    try {
      schema.parse({ name: '' });
    } catch (err) {
      if (err instanceof ZodError) {
        const issues = err.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        }));
        expect(issues[0]!.path).toBe('name');
        expect(issues[0]!.message).toBeTruthy();
      }
    }
  });
});
