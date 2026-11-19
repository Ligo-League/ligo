import type { z } from 'zod';

// The admin panel's settings forms (phase 3h; design doc section 7). Each setting is a form field
// named by its path in the settings object ("scheduling.time_zone"); the typed values are put
// into a copy of the current settings, which the setting's own zod schema then checks, so the
// panel accepts exactly what the bot and the services accept. Each problem lands on its field;
// one that belongs to no field shown (a rule across fields) lands on the form.

export type FieldKind =
  | { type: 'int' }
  /** Empty means null: "no reminder", "no deadline". */
  | { type: 'optionalInt' }
  | { type: 'text' }
  | { type: 'choice'; options: readonly string[] }
  /** A checkbox: sent when ticked, absent otherwise. */
  | { type: 'bool' };

export interface SettingField {
  path: string;
  kind: FieldKind;
}

export type SettingFieldError = 'invalid' | 'not_integer';
export type SettingErrors = Record<string, SettingFieldError>;

const INTEGER = /^-?\d{1,9}$/;

/** A deep copy of plain JSON data. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function setAt(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let node = target;
  for (const key of keys.slice(0, -1)) {
    const next = node[key];
    if (typeof next !== 'object' || next === null) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[keys.at(-1) ?? path] = value;
}

/** The value a field gives, or the problem with what was typed. */
function readField(
  kind: FieldKind,
  typed: string | undefined,
): { value: unknown } | { error: SettingFieldError } {
  const text = (typed ?? '').trim();
  switch (kind.type) {
    case 'bool':
      return { value: typed !== undefined && typed !== '' };
    case 'text':
      return { value: text };
    case 'choice':
      return kind.options.includes(text) ? { value: text } : { error: 'invalid' };
    case 'int':
    case 'optionalInt':
      if (text === '') return kind.type === 'optionalInt' ? { value: null } : { error: 'invalid' };
      if (!INTEGER.test(text))
        return { error: /^-?\d+([.,]\d+)?$/.test(text) ? 'not_integer' : 'invalid' };
      return { value: Number(text) };
  }
}

export type SettingsRead<T> = { ok: true; value: T } | { ok: false; errors: SettingErrors };

/**
 * Reads a settings form over the current settings: fields not on the form keep their value. The
 * result is what the schema returns, defaults filled.
 */
export function readSettingsForm<T>(
  schema: z.ZodType<T>,
  current: T,
  fields: readonly SettingField[],
  form: Readonly<Record<string, string>>,
  /** Shapes what was typed before the schema sees it: an empty weekday means no slot, say. */
  prepare?: (draft: Record<string, unknown>) => void,
): SettingsRead<T> {
  const draft = copy(current) as Record<string, unknown>;
  const errors: SettingErrors = {};
  for (const field of fields) {
    const read = readField(field.kind, form[field.path]);
    if ('error' in read) errors[field.path] = read.error;
    else setAt(draft, field.path, read.value);
  }
  prepare?.(draft);
  // A field typed wrong keeps its current value, so the schema still checks every other one.
  const parsed = schema.safeParse(draft);
  if (parsed.success && Object.keys(errors).length === 0) return { ok: true, value: parsed.data };
  if (parsed.success) return { ok: false, errors };
  const paths = new Set(fields.map((field) => field.path));
  for (const issue of parsed.error.issues) {
    const path = issue.path.map(String).join('.');
    // A problem inside a field's value (an object field) belongs to that field.
    const owner = [...paths].find((entry) => path === entry || path.startsWith(`${entry}.`));
    errors[owner ?? 'form'] ??= 'invalid';
  }
  return { ok: false, errors };
}
