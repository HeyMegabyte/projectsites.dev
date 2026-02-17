import { contactFormSchema } from '../schemas/contact.js';

describe('contactFormSchema', () => {
  const validInput = {
    name: 'Jane Doe',
    email: 'jane@example.com',
    message: 'Hello, I have a question about your services.',
  };

  // ─── Valid inputs ──────────────────────────────────────────
  it('accepts valid input with all fields', () => {
    const result = contactFormSchema.parse({
      ...validInput,
      phone: '+1234567890',
    });
    expect(result.name).toBe('Jane Doe');
    expect(result.email).toBe('jane@example.com');
    expect(result.phone).toBe('+1234567890');
    expect(result.message).toBe(validInput.message);
  });

  it('accepts valid input without phone (optional)', () => {
    const result = contactFormSchema.parse(validInput);
    expect(result.phone).toBeUndefined();
  });

  it('lowercases email', () => {
    const result = contactFormSchema.parse({
      ...validInput,
      email: 'JANE@EXAMPLE.COM',
    });
    expect(result.email).toBe('jane@example.com');
  });

  it('accepts name at boundary (200 chars)', () => {
    const result = contactFormSchema.parse({
      ...validInput,
      name: 'A'.repeat(200),
    });
    expect(result.name).toHaveLength(200);
  });

  it('accepts message at minimum boundary (10 chars)', () => {
    const result = contactFormSchema.parse({
      ...validInput,
      message: '1234567890',
    });
    expect(result.message).toHaveLength(10);
  });

  it('accepts message at maximum boundary (5000 chars)', () => {
    const result = contactFormSchema.parse({
      ...validInput,
      message: 'A'.repeat(5000),
    });
    expect(result.message).toHaveLength(5000);
  });

  it('accepts phone at boundary (20 chars)', () => {
    const result = contactFormSchema.parse({
      ...validInput,
      phone: '1'.repeat(20),
    });
    expect(result.phone).toHaveLength(20);
  });

  // ─── Name validation ──────────────────────────────────────
  it('rejects missing name', () => {
    expect(() =>
      contactFormSchema.parse({ email: 'a@b.com', message: 'Long enough message' }),
    ).toThrow();
  });

  it('rejects empty name', () => {
    expect(() =>
      contactFormSchema.parse({ name: '', email: 'a@b.com', message: 'Long enough message' }),
    ).toThrow();
  });

  it('rejects name over 200 chars', () => {
    expect(() =>
      contactFormSchema.parse({
        ...validInput,
        name: 'A'.repeat(201),
      }),
    ).toThrow();
  });

  it('rejects script tags in name', () => {
    expect(() =>
      contactFormSchema.parse({
        ...validInput,
        name: '<script>alert("xss")</script>',
      }),
    ).toThrow();
  });

  // ─── Email validation ──────────────────────────────────────
  it('rejects missing email', () => {
    expect(() =>
      contactFormSchema.parse({ name: 'Bob', message: 'Long enough message' }),
    ).toThrow();
  });

  it('rejects invalid email', () => {
    expect(() =>
      contactFormSchema.parse({
        ...validInput,
        email: 'not-an-email',
      }),
    ).toThrow();
  });

  // ─── Phone validation ─────────────────────────────────────
  it('rejects phone over 20 chars', () => {
    expect(() =>
      contactFormSchema.parse({
        ...validInput,
        phone: '1'.repeat(21),
      }),
    ).toThrow();
  });

  // ─── Message validation ────────────────────────────────────
  it('rejects missing message', () => {
    expect(() =>
      contactFormSchema.parse({ name: 'Bob', email: 'a@b.com' }),
    ).toThrow();
  });

  it('rejects short message (< 10 chars)', () => {
    expect(() =>
      contactFormSchema.parse({
        ...validInput,
        message: 'Short',
      }),
    ).toThrow();
  });

  it('rejects message over 5000 chars', () => {
    expect(() =>
      contactFormSchema.parse({
        ...validInput,
        message: 'A'.repeat(5001),
      }),
    ).toThrow();
  });

  it('rejects script tags in message', () => {
    expect(() =>
      contactFormSchema.parse({
        ...validInput,
        message: 'Hello <script>alert("xss")</script> world',
      }),
    ).toThrow();
  });

  it('rejects javascript: in message', () => {
    expect(() =>
      contactFormSchema.parse({
        ...validInput,
        message: 'Check this link: javascript:alert(1)',
      }),
    ).toThrow();
  });

  it('allows HTML entities (not script tags) in name', () => {
    const result = contactFormSchema.parse({
      ...validInput,
      name: 'Test <b>User</b>',
    });
    expect(result.name).toBe('Test <b>User</b>');
  });

  it('allows angle brackets in message when not script tags', () => {
    const result = contactFormSchema.parse({
      ...validInput,
      message: 'I need a feature like x < 100 and y > 50 in the app',
    });
    expect(result.message).toContain('x < 100');
  });
});
