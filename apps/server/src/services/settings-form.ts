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
  | { type: 'bool' }
  /** An ordered list of choices, one select per place (`path.0`, `path.1`…); empty places dropped. */
  | { type: 'choiceList'; options: readonly string[]; size: number }
  /** A list of words typed in one input, separated by spaces or commas: a veto sequence. */
  | { type: 'words' }
  /** A list of names that may hold spaces, one per line of a text area: a map pool. */
  | { type: 'lines' }
  /**
   * A list of objects, one row of inputs each (`path.0.key`, `path.0.label.fr`…), with `size` rows
   * shown: the current ones and blank ones to add. An empty row is dropped; an optional column
   * left empty is left out of its object.
   */
  | { type: 'rows'; columns: readonly { name: string; optional?: boolean }[]; size: number };

export interface SettingField {
  path: string;
  kind: FieldKind;
}

/**
 * What is wrong with a field: refused by the schema, or by its service (a name `taken`, a
 * `reserved` word, a setting `locked`, a `required` reason).
 */
export type SettingFieldError =
  'invalid' | 'not_integer' | 'taken' | 'reserved' | 'locked' | 'required';
export type SettingErrors = Record<string, SettingFieldError>;

const INTEGER = /^-?\d{1,9}$/;

/** A deep copy of plain JSON data. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function setAt(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let node = target;
  for (const [index, key] of keys.slice(0, -1).entries()) {
    const next = node[key];
    // A place in a list (`score.winner.0`) makes a list, so a tuple left null can be filled.
    if (typeof next !== 'object' || next === null) {
      node[key] = /^\d+$/.test(keys[index + 1] ?? '') ? [] : {};
    }
    node = node[key] as Record<string, unknown>;
  }
  node[keys.at(-1) ?? path] = value;
}

/** The value an input gives, or the problem with what was typed. */
function readInput(
  kind: Exclude<FieldKind, { type: 'choiceList' | 'words' | 'lines' | 'rows' }>,
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

/** The value a field gives from the form, or the problem with what was typed. */
function readField(
  field: SettingField,
  form: Readonly<Record<string, string>>,
): { value: unknown } | { error: SettingFieldError } {
  const { kind, path } = field;
  switch (kind.type) {
    case 'choiceList': {
      const chosen = Array.from({ length: kind.size }, (_, index) =>
        (form[`${path}.${String(index)}`] ?? '').trim(),
      ).filter((entry) => entry !== '');
      return chosen.every((entry) => kind.options.includes(entry))
        ? { value: chosen }
        : { error: 'invalid' };
    }
    case 'words':
      return {
        value: (form[path] ?? '').split(/[\s,]+/).filter((word) => word !== ''),
      };
    case 'lines':
      return {
        value: (form[path] ?? '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line !== ''),
      };
    case 'rows': {
      const rows: Record<string, unknown>[] = [];
      for (let index = 0; index < kind.size; index += 1) {
        const cells = kind.columns.map((column) => ({
          column,
          text: (form[`${path}.${String(index)}.${column.name}`] ?? '').trim(),
        }));
        if (cells.every((cell) => cell.text === '')) continue;
        const row: Record<string, unknown> = {};
        for (const { column, text } of cells) {
          if (text === '' && column.optional) continue;
          setAt(row, column.name, text);
        }
        rows.push(row);
      }
      return { value: rows };
    }
    default:
      return readInput(kind, form[path]);
  }
}

/** A setting's value as its input shows it. */
function shown(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';
}

/** The value at a path of the settings ("ruleset.requests.answer_within_hours"). */
export function valueAt(settings: unknown, path: string): unknown {
  let node: unknown = settings;
  for (const key of path.split('.')) {
    node =
      typeof node === 'object' && node !== null
        ? (node as Record<string, unknown>)[key]
        : undefined;
  }
  return node;
}

/** Every input of the form with its current value, by input name. */
export function settingsFormValues(
  settings: unknown,
  fields: readonly SettingField[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const { path, kind } of fields) {
    const value = valueAt(settings, path);
    const list = Array.isArray(value) ? (value as unknown[]) : [];
    switch (kind.type) {
      case 'choiceList':
        for (let index = 0; index < kind.size; index += 1) {
          values[`${path}.${String(index)}`] = shown(list[index]);
        }
        break;
      case 'words':
        values[path] = list.map(shown).join(' ');
        break;
      case 'lines':
        values[path] = list.map(shown).join('\n');
        break;
      case 'rows':
        for (let index = 0; index < kind.size; index += 1) {
          for (const column of kind.columns) {
            values[`${path}.${String(index)}.${column.name}`] = shown(
              valueAt(list[index], column.name),
            );
          }
        }
        break;
      default:
        values[path] = shown(value);
    }
  }
  return values;
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
    const read = readField(field, form);
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
    // A rule across several fields (the veto's formats, a request's deadlines) lands on their
    // group, named by the path they share; one across unrelated fields, on the form.
    const group = path !== '' && [...paths].some((entry) => entry.startsWith(`${path}.`));
    errors[owner ?? (group ? path : 'form')] ??= 'invalid';
  }
  return { ok: false, errors };
}
