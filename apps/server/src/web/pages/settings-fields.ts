import { html } from 'hono/html';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import type { SettingErrors } from '../../services/settings-form.ts';
import type { Html } from '../layout.ts';

// How the admin panel shows a settings form (phase 3h): sections of fields, each named by its
// path in the settings, with the value as typed and its problem. The service reads them back with
// `readSettingsForm`, against the setting's own schema.

export type FieldInput =
  | { type: 'text'; maxlength?: number }
  | { type: 'number'; min?: number; max?: number; optional?: boolean }
  | { type: 'select'; options: readonly { value: string; label: MessageKey }[] }
  | { type: 'checkbox' };

export interface FieldView {
  path: string;
  label: MessageKey;
  help?: MessageKey;
  input: FieldInput;
}

export interface SectionView {
  title: MessageKey;
  fields: readonly FieldView[];
}

const ERROR_KEYS = {
  invalid: 'web.admin.settings.error.invalid',
  not_integer: 'web.admin.settings.error.not_integer',
} as const satisfies Record<string, MessageKey>;

function input(locale: Locale, field: FieldView, value: string): Html {
  const { input: kind, path } = field;
  switch (kind.type) {
    case 'text':
      return html`<input
        name="${path}"
        value="${value}"
        maxlength="${String(kind.maxlength ?? 100)}"
      />`;
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
      return html`<select name="${path}">
        ${kind.options.map(
          (option) =>
            html`<option value="${option.value}" ${option.value === value ? 'selected' : ''}>
              ${t(locale, option.label)}
            </option>`,
        )}
      </select>`;
    case 'checkbox':
      return html`<input
        type="checkbox"
        name="${path}"
        value="1"
        ${value === 'true' ? 'checked' : ''}
      />`;
  }
}

/** The form's sections, with each field's value and problem; a problem across fields on top. */
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
        ${section.fields.map((field) => {
          const error = errors[field.path];
          return html`<label
              >${t(locale, field.label)} ${input(locale, field, values[field.path] ?? '')}</label
            >
            ${field.help ? html`<p class="muted">${t(locale, field.help)}</p>` : ''}
            ${error ? html`<p class="field-error">${t(locale, ERROR_KEYS[error])}</p>` : ''}`;
        })}
      </fieldset>`,
  )}`;
}
