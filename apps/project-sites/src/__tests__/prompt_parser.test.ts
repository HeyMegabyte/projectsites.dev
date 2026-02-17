import {
  parsePromptMarkdown,
  extractFrontmatter,
  splitSections,
  parseSimpleYaml,
  parseYamlScalar,
} from '../prompts/parser.js';

// ─── parsePromptMarkdown ───────────────────────────────────────

describe('parsePromptMarkdown', () => {
  it('parses a full valid prompt markdown into PromptSpec', () => {
    const raw = `---
id: research_business
version: 2
description: Research a local business
models:
  - "@cf/meta/llama-3.1-70b-instruct"
  - "@cf/openai/gpt-4o"
params:
  temperature: 0.3
  max_tokens: 4096
inputs:
  required: [business_name, city]
  optional: [phone]
outputs:
  format: json
  schema: business_schema_v1
notes:
  pii: "Avoid customer personal data"
  quality: "Cross-reference two sources"
---

# System
You are a business research assistant.

# User
Research the following business: {{business_name}} in {{city}}.
`;

    const spec = parsePromptMarkdown(raw);

    expect(spec.id).toBe('research_business');
    expect(spec.version).toBe(2);
    expect(spec.variant).toBeUndefined();
    expect(spec.description).toBe('Research a local business');
    expect(spec.models).toEqual(['@cf/meta/llama-3.1-70b-instruct', '@cf/openai/gpt-4o']);
    expect(spec.params).toEqual({ temperature: 0.3, maxTokens: 4096 });
    expect(spec.inputs).toEqual({
      required: ['business_name', 'city'],
      optional: ['phone'],
    });
    expect(spec.outputs).toEqual({ format: 'json', schema: 'business_schema_v1' });
    expect(spec.notes).toEqual({
      pii: 'Avoid customer personal data',
      quality: 'Cross-reference two sources',
    });
    expect(spec.system).toBe('You are a business research assistant.');
    expect(spec.user).toBe('Research the following business: {{business_name}} in {{city}}.');
  });

  it('parses a prompt with a variant field', () => {
    const raw = `---
id: summarize_article
version: 1
variant: b
description: Summarize an article concisely
models: ["@cf/meta/llama-3.1-70b-instruct"]
params:
  temperature: 0.5
  max_tokens: 2048
inputs:
  required: [article_text]
outputs:
  format: markdown
---

# System
You are a summarization expert.

# User
Summarize this article: {{article_text}}
`;

    const spec = parsePromptMarkdown(raw);

    expect(spec.id).toBe('summarize_article');
    expect(spec.version).toBe(1);
    expect(spec.variant).toBe('b');
    expect(spec.description).toBe('Summarize an article concisely');
    expect(spec.models).toEqual(['@cf/meta/llama-3.1-70b-instruct']);
    expect(spec.params).toEqual({ temperature: 0.5, maxTokens: 2048 });
    expect(spec.inputs.required).toEqual(['article_text']);
    expect(spec.inputs.optional).toEqual([]);
    expect(spec.outputs).toEqual({ format: 'markdown', schema: undefined });
  });

  it('handles minimal frontmatter with defaults for optional fields', () => {
    const raw = `---
id: simple_prompt
version: 1
---

# System
Do the thing.

# User
Hello.
`;

    const spec = parsePromptMarkdown(raw);

    expect(spec.id).toBe('simple_prompt');
    expect(spec.version).toBe(1);
    expect(spec.variant).toBeUndefined();
    expect(spec.description).toBe('');
    expect(spec.models).toEqual([]);
    expect(spec.params).toEqual({ temperature: 0.3, maxTokens: 4096 });
    expect(spec.inputs).toEqual({ required: [], optional: [] });
    expect(spec.outputs).toEqual({ format: 'text', schema: undefined });
    expect(spec.notes).toEqual({});
    expect(spec.system).toBe('Do the thing.');
    expect(spec.user).toBe('Hello.');
  });

  it('throws when id is missing from frontmatter', () => {
    const raw = `---
version: 1
---

# System
Sys.

# User
Usr.
`;

    expect(() => parsePromptMarkdown(raw)).toThrow('Prompt frontmatter missing required field: id');
  });

  it('throws when version is missing from frontmatter', () => {
    const raw = `---
id: no_version
---

# System
Sys.

# User
Usr.
`;

    expect(() => parsePromptMarkdown(raw)).toThrow(
      'Prompt frontmatter missing required field: version',
    );
  });
});

// ─── extractFrontmatter ────────────────────────────────────────

describe('extractFrontmatter', () => {
  it('extracts frontmatter and body from valid input', () => {
    const raw = `---
id: test
version: 1
---

# System
Hello world.
`;

    const result = extractFrontmatter(raw);

    expect(result.frontmatter).toBe('id: test\nversion: 1');
    expect(result.body).toBe('# System\nHello world.');
  });

  it('throws when the opening --- is missing', () => {
    const raw = `id: test
version: 1
---

# System
Body here.
`;

    expect(() => extractFrontmatter(raw)).toThrow(
      'Prompt file must start with YAML frontmatter (---)',
    );
  });

  it('throws when the closing --- is missing', () => {
    const raw = `---
id: test
version: 1

# System
Body here.
`;

    expect(() => extractFrontmatter(raw)).toThrow('Prompt file has unclosed YAML frontmatter');
  });

  it('returns an empty body when there is only frontmatter', () => {
    const raw = `---
id: test
version: 1
---`;

    const result = extractFrontmatter(raw);

    expect(result.frontmatter).toBe('id: test\nversion: 1');
    expect(result.body).toBe('');
  });
});

// ─── splitSections ─────────────────────────────────────────────

describe('splitSections', () => {
  it('splits body into system and user sections', () => {
    const body = `# System
You are helpful.

# User
What is 2+2?`;

    const result = splitSections(body);

    expect(result.system).toBe('You are helpful.');
    expect(result.user).toBe('What is 2+2?');
  });

  it('throws when # System section is missing', () => {
    const body = `# User
What is 2+2?`;

    expect(() => splitSections(body)).toThrow('Prompt body must contain a "# System" section');
  });

  it('throws when # User section is missing', () => {
    const body = `# System
You are helpful.`;

    expect(() => splitSections(body)).toThrow('Prompt body must contain a "# User" section');
  });

  it('ignores extra sections after # User', () => {
    const body = `# System
System content here.

# User
User content here.

# Notes
This section should be part of user content.`;

    const result = splitSections(body);

    expect(result.system).toBe('System content here.');
    expect(result.user).toBe(
      'User content here.\n\n# Notes\nThis section should be part of user content.',
    );
  });
});

// ─── parseSimpleYaml ───────────────────────────────────────────

describe('parseSimpleYaml', () => {
  it('parses scalar values (string, number, boolean, null, quoted)', () => {
    const yaml = `name: hello
count: 42
pi: 3.14
enabled: true
disabled: false
nothing: null
tilde: ~
quoted_double: "hello world"
quoted_single: 'foo bar'`;

    const result = parseSimpleYaml(yaml);

    expect(result.name).toBe('hello');
    expect(result.count).toBe(42);
    expect(result.pi).toBe(3.14);
    expect(result.enabled).toBe(true);
    expect(result.disabled).toBe(false);
    expect(result.nothing).toBeNull();
    expect(result.tilde).toBeNull();
    expect(result.quoted_double).toBe('hello world');
    expect(result.quoted_single).toBe('foo bar');
  });

  it('parses inline arrays', () => {
    const yaml = `tags: [alpha, beta, gamma]
ids: [1, 2, 3]
mixed: [hello, 42, true, null]
empty: []`;

    const result = parseSimpleYaml(yaml);

    expect(result.tags).toEqual(['alpha', 'beta', 'gamma']);
    expect(result.ids).toEqual([1, 2, 3]);
    expect(result.mixed).toEqual(['hello', 42, true, null]);
    expect(result.empty).toEqual([]);
  });

  it('parses block arrays', () => {
    const yaml = `models:
  - "@cf/meta/llama-3.1-70b-instruct"
  - "@cf/openai/gpt-4o"
  - plain_model`;

    const result = parseSimpleYaml(yaml);

    expect(result.models).toEqual([
      '@cf/meta/llama-3.1-70b-instruct',
      '@cf/openai/gpt-4o',
      'plain_model',
    ]);
  });

  it('parses nested objects (one level deep)', () => {
    const yaml = `params:
  temperature: 0.3
  max_tokens: 4096`;

    const result = parseSimpleYaml(yaml);

    expect(result.params).toEqual({ temperature: 0.3, max_tokens: 4096 });
  });

  it('parses nested objects with inline arrays', () => {
    const yaml = `inputs:
  required: [business_name, city]
  optional: [phone, email]`;

    const result = parseSimpleYaml(yaml);

    expect(result.inputs).toEqual({
      required: ['business_name', 'city'],
      optional: ['phone', 'email'],
    });
  });

  it('treats a key with no value and no children as null', () => {
    const yaml = `empty_key:
next_key: hello`;

    const result = parseSimpleYaml(yaml);

    expect(result.empty_key).toBeNull();
    expect(result.next_key).toBe('hello');
  });

  it('skips comments and empty lines', () => {
    const yaml = `# This is a comment
id: test

# Another comment
version: 5`;

    const result = parseSimpleYaml(yaml);

    expect(result.id).toBe('test');
    expect(result.version).toBe(5);
    expect(Object.keys(result)).toHaveLength(2);
  });
});

// ─── parseYamlScalar ───────────────────────────────────────────

describe('parseYamlScalar', () => {
  it('parses integers', () => {
    expect(parseYamlScalar('42')).toBe(42);
    expect(parseYamlScalar('0')).toBe(0);
    expect(parseYamlScalar('-7')).toBe(-7);
  });

  it('parses floating point numbers', () => {
    expect(parseYamlScalar('3.14')).toBe(3.14);
    expect(parseYamlScalar('0.001')).toBe(0.001);
  });

  it('parses boolean values', () => {
    expect(parseYamlScalar('true')).toBe(true);
    expect(parseYamlScalar('false')).toBe(false);
  });

  it('parses null values', () => {
    expect(parseYamlScalar('null')).toBeNull();
    expect(parseYamlScalar('~')).toBeNull();
  });

  it('parses double-quoted strings and strips quotes', () => {
    expect(parseYamlScalar('"hello world"')).toBe('hello world');
    expect(parseYamlScalar('"contains 42 number"')).toBe('contains 42 number');
    expect(parseYamlScalar('""')).toBe('');
  });

  it('parses single-quoted strings and strips quotes', () => {
    expect(parseYamlScalar("'foo bar'")).toBe('foo bar');
    expect(parseYamlScalar("'true'")).toBe('true');
    expect(parseYamlScalar("''")).toBe('');
  });

  it('returns unquoted non-numeric strings as-is', () => {
    expect(parseYamlScalar('hello')).toBe('hello');
    expect(parseYamlScalar('some_identifier')).toBe('some_identifier');
    expect(parseYamlScalar('@cf/meta/llama')).toBe('@cf/meta/llama');
  });
});
