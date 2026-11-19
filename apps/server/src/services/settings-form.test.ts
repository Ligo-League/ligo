import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { readSettingsForm, type SettingField } from './settings-form.ts';

// The admin panel's settings forms (phase 3h): each setting is a field named by its path in the
// settings; the typed values go into a copy of the settings, which the setting's own zod schema
// then checks, each problem landing on its field.

const schema = z.strictObject({
  mode: z.enum(['staff', 'opponent']),
  hours: z.int().min(1).max(720),
  remind: z.int().min(0).nullable(),
  nested: z.strictObject({ name: z.string().min(2), on: z.boolean() }),
  untouched: z.string(),
});
type Settings = z.infer<typeof schema>;

const FIELDS: readonly SettingField[] = [
  { path: 'mode', kind: { type: 'choice', options: ['staff', 'opponent'] } },
  { path: 'hours', kind: { type: 'int' } },
  { path: 'remind', kind: { type: 'optionalInt' } },
  { path: 'nested.name', kind: { type: 'text' } },
  { path: 'nested.on', kind: { type: 'bool' } },
];
const CURRENT: Settings = {
  mode: 'staff',
  hours: 24,
  remind: 6,
  nested: { name: 'LFR', on: true },
  untouched: 'kept',
};

describe('reading a settings form', () => {
  it('puts each typed value at its path, and keeps what the form does not show', () => {
    const read = readSettingsForm(schema, CURRENT, FIELDS, {
      mode: 'opponent',
      hours: ' 48 ',
      remind: '',
      'nested.name': '  Ligue  ',
    });
    expect(read).toEqual({
      ok: true,
      value: {
        mode: 'opponent',
        hours: 48,
        remind: null,
        // An unticked box is not sent.
        nested: { name: 'Ligue', on: false },
        untouched: 'kept',
      },
    });
    // The current settings are not changed.
    expect(CURRENT.hours).toBe(24);
  });

  it('names the field of each problem: not a number, or refused by the schema', () => {
    const read = readSettingsForm(schema, CURRENT, FIELDS, {
      mode: 'nobody',
      hours: '2.5',
      remind: '-1',
      'nested.name': 'L',
      'nested.on': '1',
    });
    expect(read).toEqual({
      ok: false,
      errors: {
        mode: 'invalid',
        hours: 'not_integer',
        remind: 'invalid',
        'nested.name': 'invalid',
      },
    });
  });

  it('puts a problem of no field shown on the form as a whole', () => {
    const strict = schema.refine((value) => value.remind === null || value.remind < value.hours, {
      error: 'The reminder comes first.',
    });
    expect(
      readSettingsForm(strict, CURRENT, FIELDS, {
        mode: 'staff',
        hours: '4',
        remind: '5',
        'nested.name': 'LFR',
        'nested.on': '1',
      }),
    ).toEqual({ ok: false, errors: { form: 'invalid' } });
  });
});
