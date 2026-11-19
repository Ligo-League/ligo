import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { readSettingsForm, settingsFormValues, type SettingField } from './settings-form.ts';

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

describe('fields holding lists', () => {
  const lists = z.strictObject({
    criteria: z.array(z.enum(['points', 'diff', 'wins'])).min(1),
    sequence: z.array(z.enum(['A_ban', 'B_ban', 'A_pick'])),
    reasons: z.array(
      z.strictObject({
        key: z.string().regex(/^[a-z_]+$/),
        label: z.strictObject({ fr: z.string().min(1), en: z.string().min(1).optional() }),
      }),
    ),
  });
  const current: z.infer<typeof lists> = {
    criteria: ['points', 'diff'],
    sequence: ['A_ban', 'B_ban'],
    reasons: [{ key: 'wrong_score', label: { fr: 'Score incorrect', en: 'Wrong score' } }],
  };
  const fields: readonly SettingField[] = [
    {
      path: 'criteria',
      kind: { type: 'choiceList', options: ['points', 'diff', 'wins'], size: 3 },
    },
    { path: 'sequence', kind: { type: 'words' } },
    {
      path: 'reasons',
      kind: {
        type: 'rows',
        size: 3,
        columns: [{ name: 'key' }, { name: 'label.fr' }, { name: 'label.en', optional: true }],
      },
    },
  ];

  it('shows each list as the inputs its form has', () => {
    expect(settingsFormValues(current, fields)).toEqual({
      'criteria.0': 'points',
      'criteria.1': 'diff',
      'criteria.2': '',
      sequence: 'A_ban B_ban',
      'reasons.0.key': 'wrong_score',
      'reasons.0.label.fr': 'Score incorrect',
      'reasons.0.label.en': 'Wrong score',
      'reasons.1.key': '',
      'reasons.1.label.fr': '',
      'reasons.1.label.en': '',
      'reasons.2.key': '',
      'reasons.2.label.fr': '',
      'reasons.2.label.en': '',
    });
  });

  it('reads them back, leaving out the empty places and rows', () => {
    expect(
      readSettingsForm(lists, current, fields, {
        'criteria.0': 'diff',
        'criteria.1': '',
        'criteria.2': 'wins',
        sequence: ' A_ban, B_ban  A_pick ',
        'reasons.0.key': 'wrong_score',
        'reasons.0.label.fr': 'Score faux',
        'reasons.0.label.en': '',
        'reasons.2.key': 'late',
        'reasons.2.label.fr': 'Retard',
      }),
    ).toEqual({
      ok: true,
      value: {
        criteria: ['diff', 'wins'],
        sequence: ['A_ban', 'B_ban', 'A_pick'],
        reasons: [
          { key: 'wrong_score', label: { fr: 'Score faux' } },
          { key: 'late', label: { fr: 'Retard' } },
        ],
      },
    });
  });

  it('puts a problem inside a list on the list', () => {
    expect(
      readSettingsForm(lists, current, fields, {
        'criteria.0': 'nonsense',
        sequence: 'A_ban C_ban',
        'reasons.0.key': 'Bad Key',
        'reasons.0.label.fr': 'x',
      }),
    ).toEqual({
      ok: false,
      errors: { criteria: 'invalid', sequence: 'invalid', reasons: 'invalid' },
    });
  });
});

describe('a rule across several fields', () => {
  it('lands on the group of fields it is about', () => {
    const grouped = z.strictObject({
      deadline: z
        .strictObject({ answer: z.int(), remind: z.int() })
        .refine((value) => value.remind < value.answer),
    });
    const fields: readonly SettingField[] = [
      { path: 'deadline.answer', kind: { type: 'int' } },
      { path: 'deadline.remind', kind: { type: 'int' } },
    ];
    expect(
      readSettingsForm(grouped, { deadline: { answer: 24, remind: 6 } }, fields, {
        'deadline.answer': '4',
        'deadline.remind': '6',
      }),
    ).toEqual({ ok: false, errors: { deadline: 'invalid' } });
  });
});

describe('lines and pairs', () => {
  const pairs = z.strictObject({
    pool: z.array(z.string().min(1)),
    score: z.strictObject({ win: z.tuple([z.int(), z.int()]) }).nullable(),
  });
  const fields: readonly SettingField[] = [
    { path: 'pool', kind: { type: 'lines' } },
    { path: 'score.win.0', kind: { type: 'optionalInt' } },
    { path: 'score.win.1', kind: { type: 'optionalInt' } },
  ];

  it('shows a list of names one per line, and reads it back without blank lines', () => {
    const current = { pool: ['Bank', 'Kafe Dostoyevsky'], score: null };
    expect(settingsFormValues(current, fields)).toEqual({
      pool: 'Bank\nKafe Dostoyevsky',
      'score.win.0': '',
      'score.win.1': '',
    });
    expect(
      readSettingsForm(pairs, current, fields, {
        pool: ' Bank \r\n\r\nNighthaven Labs\n',
        'score.win.0': '7',
        'score.win.1': '3',
      }),
    ).toEqual({
      ok: true,
      value: { pool: ['Bank', 'Nighthaven Labs'], score: { win: [7, 3] } },
    });
  });
});
