import { html } from 'hono/html';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import type { SettingErrors, SettingFieldError } from '../../services/settings-form.ts';
import type { Html } from '../layout.ts';

// How the admin panel shows a settings form (phase 3h): sections of fields, each named by its
// path in the settings, with the value as typed and its problem. The service reads them back with
// `readSettingsForm`, against the setting's own schema. Lists use one input per place
// (`path.0`, `path.1`…) and rows one input per column (`path.0.key`); they work without scripts.

type Option = { value: string; label: MessageKey };

export type FieldInput =
  | { type: 'text'; maxlength?: number }
  | { type: 'date' }
  /** One entry per line: a map pool. */
  | { type: 'textarea'; rows: number }
  | { type: 'number'; min?: number; max?: number; optional?: boolean }
  | { type: 'select'; options: readonly Option[] }
  | { type: 'checkbox' }
  /** One select per place, each with an empty choice: an ordered list. */
  | { type: 'selectList'; options: readonly Option[]; size: number }
  /** A table of rows, one input per column. */
  | {
      type: 'rows';
      size: number;
      columns: readonly { name: string; label: MessageKey; maxlength: number }[];
    };

export interface FieldView {
  path: string;
  label: MessageKey;
  help?: MessageKey;
  input: FieldInput;
}

export interface SectionView {
  title: MessageKey;
  fields: readonly FieldView[];
  /**
   * What a rule across several of the section's fields says when it fails, by their shared path;
   * a group the service refuses for another reason (`locked`) says that reason.
   */
  groups?: Readonly<Record<string, MessageKey>>;
}

const ERROR_KEYS = {
  invalid: 'web.admin.settings.error.invalid',
  not_integer: 'web.admin.settings.error.not_integer',
  taken: 'web.admin.settings.error.taken',
  reserved: 'web.admin.settings.error.reserved',
  locked: 'web.admin.settings.error.locked',
  required: 'web.admin.settings.error.required',
  not_in_server: 'league.error.channel_not_in_server',
  cannot_post: 'league.error.cannot_post',
} as const satisfies Record<string, MessageKey>;

/** What a field's problem says. */
export const settingErrorKey = (error: SettingFieldError): MessageKey => ERROR_KEYS[error];

const select = (locale: Locale, name: string, options: readonly Option[], value: string): Html =>
  html`<select name="${name}">
    ${options.map(
      (option) =>
        html`<option value="${option.value}" ${option.value === value ? 'selected' : ''}>
          ${t(locale, option.label)}
        </option>`,
    )}
  </select>`;

function input(locale: Locale, field: FieldView, values: Readonly<Record<string, string>>): Html {
  const { input: kind, path } = field;
  const value = values[path] ?? '';
  switch (kind.type) {
    case 'text':
      return html`<input
        name="${path}"
        value="${value}"
        maxlength="${String(kind.maxlength ?? 100)}"
      />`;
    case 'date':
      return html`<input type="date" name="${path}" value="${value}" required />`;
    case 'textarea':
      return html`<textarea name="${path}" rows="${String(kind.rows)}">${value}</textarea>`;
    case 'number':
      return html`<input
        name="${path}"
        value="${value}"
        inputmode="numeric"
        ${kind.min === undefined ? '' : html`min="${String(kind.min)}"`}
        ${kind.max === undefined ? '' : html`max="${String(kind.max)}"`}
        ${kind.optional ? '' : 'required'}
      />`;
    case 'select':
      return select(locale, path, kind.options, value);
    case 'checkbox':
      return html`<input
        type="checkbox"
        name="${path}"
        value="1"
        ${value === 'true' ? 'checked' : ''}
      />`;
    case 'selectList':
      return html`<span class="select-list">
        ${Array.from({ length: kind.size }, (_, index) =>
          select(
            locale,
            `${path}.${String(index)}`,
            [{ value: '', label: 'web.admin.settings.none' }, ...kind.options],
            values[`${path}.${String(index)}`] ?? '',
          ),
        )}
      </span>`;
    case 'rows':
      return html`<table class="settings-rows">
        <thead>
          <tr>
            ${kind.columns.map((column) => html`<th scope="col">${t(locale, column.label)}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${Array.from(
            { length: kind.size },
            (_, index) =>
              html`<tr>
                ${kind.columns.map((column) => {
                  const name = `${path}.${String(index)}.${column.name}`;
                  return html`<td>
                    <input
                      name="${name}"
                      value="${values[name] ?? ''}"
                      maxlength="${String(column.maxlength)}"
                      aria-label="${t(locale, column.label)}"
                    />
                  </td>`;
                })}
              </tr>`,
          )}
        </tbody>
      </table>`;
  }
}

/** The form's sections, with each field's value and problem; a rule across fields on its section. */
export function settingsSections(
  locale: Locale,
  sections: readonly SectionView[],
  values: Readonly<Record<string, string>>,
  errors: SettingErrors,
): Html {
  return html`${
    errors.form
      ? html`<p class="card flash error">${t(locale, 'web.admin.settings.error.form')}</p>`
      : ''
  }
  ${sections.map(
    (section) =>
      html`<fieldset>
        <legend>${t(locale, section.title)}</legend>
        ${Object.entries(section.groups ?? {}).map(([group, message]) => {
          const error = errors[group];
          if (!error) return '';
          return html`<p class="field-error">
            ${t(locale, error === 'invalid' ? message : ERROR_KEYS[error])}
          </p>`;
        })}
        ${section.fields.map((field) => {
          const error = errors[field.path];
          return html`<label>${t(locale, field.label)} ${input(locale, field, values)}</label>
            ${field.help ? html`<p class="muted">${t(locale, field.help)}</p>` : ''}
            ${error ? html`<p class="field-error">${t(locale, ERROR_KEYS[error])}</p>` : ''}`;
        })}
      </fieldset>`,
  )}`;
}
