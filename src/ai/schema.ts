/**
 * A small, provider-neutral JSON schema dialect for structured model output
 * (Section 12: every call returns JSON against a schema). The relay translates
 * it to the provider's own format, so swapping provider changes one module.
 */

export type OutputSchema =
  | { type: 'object'; properties: Record<string, OutputSchema>; required?: readonly string[]; nullable?: boolean; description?: string }
  | { type: 'array'; items: OutputSchema; nullable?: boolean; description?: string; maxItems?: number }
  | { type: 'string'; enum?: readonly string[]; nullable?: boolean; description?: string }
  | { type: 'number' | 'integer' | 'boolean'; nullable?: boolean; description?: string };

const MAX_DEPTH = 8;
const MAX_NODES = 600;

/** True when `s` is a well-formed schema in this dialect, within size limits (checked by the relay). */
export function isOutputSchema(s: unknown): s is OutputSchema {
  let nodes = 0;
  const check = (x: unknown, depth: number): boolean => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) return false;
    if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
    const o = x as Record<string, unknown>;
    if (o.nullable !== undefined && typeof o.nullable !== 'boolean') return false;
    if (o.description !== undefined && (typeof o.description !== 'string' || o.description.length > 500)) return false;
    switch (o.type) {
      case 'object': {
        if (typeof o.properties !== 'object' || o.properties === null || Array.isArray(o.properties)) return false;
        const props = o.properties as Record<string, unknown>;
        if (o.required !== undefined) {
          if (!Array.isArray(o.required) || !o.required.every((k) => typeof k === 'string' && k in props)) return false;
        }
        return Object.entries(props).every(([k, v]) => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k) && check(v, depth + 1));
      }
      case 'array':
        if (o.maxItems !== undefined && (!Number.isInteger(o.maxItems) || (o.maxItems as number) < 1)) return false;
        return check(o.items, depth + 1);
      case 'string':
        return o.enum === undefined || (Array.isArray(o.enum) && o.enum.length > 0 && o.enum.every((e) => typeof e === 'string' && e.length <= 200));
      case 'number':
      case 'integer':
      case 'boolean':
        return true;
      default:
        return false;
    }
  };
  return check(s, 0);
}

export interface SchemaIssue {
  path: string;
  problem: string;
}

/**
 * Checks a parsed model response against the schema. Prompt instructions are
 * not a control (Section 12): the app checks the shape of every response
 * itself, and a response that does not conform is not used.
 */
export function validateOutput(value: unknown, schema: OutputSchema, path = '$'): SchemaIssue[] {
  if (value === null) return schema.nullable ? [] : [{ path, problem: 'null' }];
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) return [{ path, problem: 'not an object' }];
      const o = value as Record<string, unknown>;
      const issues: SchemaIssue[] = [];
      for (const k of schema.required ?? []) if (!(k in o) || o[k] === undefined) issues.push({ path: `${path}.${k}`, problem: 'missing' });
      for (const [k, v] of Object.entries(o)) {
        const sub = schema.properties[k];
        if (!sub) continue; // unknown keys are ignored, never used
        if (v === undefined) continue;
        issues.push(...validateOutput(v, sub, `${path}.${k}`));
      }
      return issues;
    }
    case 'array': {
      if (!Array.isArray(value)) return [{ path, problem: 'not an array' }];
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return [{ path, problem: 'too many items' }];
      return value.flatMap((v, i) => validateOutput(v, schema.items, `${path}[${i}]`));
    }
    case 'string':
      if (typeof value !== 'string') return [{ path, problem: 'not a string' }];
      if (schema.enum && !schema.enum.includes(value)) return [{ path, problem: 'not an allowed value' }];
      return [];
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? [] : [{ path, problem: 'not a number' }];
    case 'integer':
      return Number.isInteger(value) ? [] : [{ path, problem: 'not an integer' }];
    case 'boolean':
      return typeof value === 'boolean' ? [] : [{ path, problem: 'not a boolean' }];
  }
}

// Builders keep schema literals short and readable.
export const S = {
  str: (description?: string): OutputSchema => ({ type: 'string', description }),
  strOrNull: (description?: string): OutputSchema => ({ type: 'string', nullable: true, description }),
  enumOf: (values: readonly string[], description?: string): OutputSchema => ({ type: 'string', enum: values, description }),
  enumOrNull: (values: readonly string[], description?: string): OutputSchema => ({ type: 'string', enum: values, nullable: true, description }),
  num: (description?: string): OutputSchema => ({ type: 'number', description }),
  numOrNull: (description?: string): OutputSchema => ({ type: 'number', nullable: true, description }),
  bool: (description?: string): OutputSchema => ({ type: 'boolean', description }),
  arr: (items: OutputSchema, maxItems?: number, description?: string): OutputSchema => ({ type: 'array', items, maxItems, description }),
  obj: (properties: Record<string, OutputSchema>, required: readonly string[] = Object.keys(properties), description?: string): OutputSchema => ({
    type: 'object',
    properties,
    required,
    description,
  }),
};
