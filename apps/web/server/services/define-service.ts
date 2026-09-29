import { err, type Result } from 'neverthrow';
import { z } from 'zod';
import type { ServiceContext } from './context';
import { serviceError, type ServiceError } from './errors';

export type ServiceResult<T> = Result<T, ServiceError>;

export type ServiceDefinition<S extends z.ZodType, T> = {
  /** Stable dotted name, reused as the MCP tool id where exposed (spec 13.3). */
  name: string;
  input: S;
  handler: (ctx: ServiceContext, input: z.output<S>) => Promise<ServiceResult<T>>;
};

export type Service<S extends z.ZodType, T> = ServiceDefinition<S, T> & {
  run: (ctx: ServiceContext, rawInput: unknown) => Promise<ServiceResult<T>>;
};

/**
 * The single mutation entry point for UI and MCP (spec 13.1): input is always validated by the
 * service's own Zod schema, so adapters stay thin and cannot skip validation.
 */
export function defineService<S extends z.ZodType, T>(
  definition: ServiceDefinition<S, T>,
): Service<S, T> {
  return {
    ...definition,
    run: async (ctx, rawInput) => {
      const parsed = definition.input.safeParse(rawInput);
      if (!parsed.success) {
        return err(
          serviceError(
            'validation_error',
            'Перевірте введені дані',
            z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
          ),
        );
      }
      return definition.handler(ctx, parsed.data);
    },
  };
}
