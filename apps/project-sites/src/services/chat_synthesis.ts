/**
 * @module services/chat_synthesis
 * @description Synthesizes bolt.diy-compatible chat JSON from headless pipeline output.
 *
 * When the headless LLM pipeline generates a site, this module creates a
 * synthetic chat conversation that bolt.diy can load for "AI Edit" iterations.
 * The chat is stored at `sites/{slug}/{version}/_meta/chat.json` in R2.
 *
 * @packageDocumentation
 */

export interface SynthesizedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface SynthesizedChat {
  messages: SynthesizedMessage[];
  description: string;
  exportDate: string;
  metadata: {
    generator: 'headless-pipeline';
    model_used: string;
    quality_score: number;
    page_count: number;
  };
}

export interface SynthesisInput {
  businessName: string;
  businessAddress?: string;
  slug: string;
  structurePlan?: Record<string, unknown>;
  files: Array<{ path: string; content: string }>;
  modelUsed: string;
  qualityScore: number;
}

/**
 * Synthesize a bolt.diy-compatible chat JSON from pipeline output.
 *
 * Creates a two-message conversation:
 * 1. User message: "Build a website for {business}"
 * 2. Assistant message: Structure plan + boltArtifact with all files
 *
 * @param input - Pipeline output data
 * @returns Chat JSON ready for R2 storage
 *
 * @example
 * ```ts
 * const chat = synthesizeChatJson({
 *   businessName: "Vito's Mens Salon",
 *   slug: 'vitos-mens-salon',
 *   files: [{ path: 'index.html', content: '<!DOCTYPE html>...' }],
 *   modelUsed: 'gpt-4o',
 *   qualityScore: 85,
 * });
 * ```
 */
export function synthesizeChatJson(input: SynthesisInput): SynthesizedChat {
  const now = new Date().toISOString();

  // Build the user message
  const userParts = [`Build a website for ${input.businessName}`];
  if (input.businessAddress) {
    userParts.push(`at ${input.businessAddress}`);
  }
  const userContent = userParts.join(' ');

  // Build the assistant message with boltArtifact format
  const fileActions = input.files.map((f) => {
    const escaped = f.content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<boltAction type="file" filePath="${f.path}">${escaped}</boltAction>`;
  });

  const planSummary = input.structurePlan
    ? `I've planned a ${input.files.length}-page website with the following structure:\n\n` +
      JSON.stringify(input.structurePlan, null, 2).substring(0, 500) + '\n\n'
    : '';

  const assistantContent = [
    `I'll create a professional website for ${input.businessName}.`,
    '',
    planSummary,
    `<boltArtifact id="site-${input.slug}" title="${input.businessName} Website">`,
    ...fileActions,
    '</boltArtifact>',
    '',
    `Website generated with ${input.files.length} pages. Quality score: ${input.qualityScore}/100.`,
  ].join('\n');

  return {
    messages: [
      {
        id: `msg-user-${crypto.randomUUID().substring(0, 8)}`,
        role: 'user',
        content: userContent,
        createdAt: now,
      },
      {
        id: `msg-asst-${crypto.randomUUID().substring(0, 8)}`,
        role: 'assistant',
        content: assistantContent,
        createdAt: now,
      },
    ],
    description: `${input.businessName} Website`,
    exportDate: now,
    metadata: {
      generator: 'headless-pipeline',
      model_used: input.modelUsed,
      quality_score: input.qualityScore,
      page_count: input.files.length,
    },
  };
}
