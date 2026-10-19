import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

export const CLAUDE_MODEL = 'claude-opus-5-5';

export type AiFailure = 'invalid_key' | 'rate_limited' | 'refused' | 'unavailable' | 'bad_output';

/** What Claude may say about one import row; every id is re-checked against the DB afterwards. */
export const suggestionItem = z.object({
  key: z.string(),
  type: z.enum([
    'revenue',
    'expense',
    'transfer',
    'fx_exchange',
    'crypto_buy',
    'crypto_sell',
    'crypto_swap',
  ]),
  categoryId: z.string().nullable(),
  personId: z.string().nullable(),
  clientId: z.string().nullable(),
  description: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string(),
});

export const suggestionOutput = z.object({ items: z.array(suggestionItem) });
export type SuggestionOutput = z.infer<typeof suggestionOutput>;

export type Usage = { inputTokens: number; outputTokens: number };

export type ClaudeClient = {
  /** A free call that fails on a wrong or revoked key. */
  verify(): Promise<Result<void, AiFailure>>;
  suggest(prompt: {
    system: string;
    user: string;
  }): Promise<Result<{ output: SuggestionOutput; usage: Usage }, AiFailure>>;
};

function failureOf(error: unknown): AiFailure {
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return 'invalid_key';
  }
  if (error instanceof Anthropic.RateLimitError) return 'rate_limited';
  if (error instanceof Anthropic.APIError || error instanceof Anthropic.APIConnectionError) {
    return 'unavailable';
  }
  throw error;
}

/** The user's own key (A-120); requests go straight to the Anthropic API, nothing is kept there. */
export function claudeClient(apiKey: string): ClaudeClient {
  const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
  return {
    async verify() {
      try {
        await client.models.retrieve(CLAUDE_MODEL);
        return ok(undefined);
      } catch (error) {
        return err(failureOf(error));
      }
    },
    async suggest({ system, user }) {
      try {
        const response = await client.beta.messages.parse({
          model: CLAUDE_MODEL,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'medium', format: betaZodOutputFormat(suggestionOutput) },
          system,
          messages: [{ role: 'user', content: user }],
        });
        if (response.stop_reason === 'refusal') return err('refused');
        if (!response.parsed_output) return err('bad_output');
        return ok({
          output: response.parsed_output,
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          },
        });
      } catch (error) {
        return err(failureOf(error));
      }
    },
  };
}
