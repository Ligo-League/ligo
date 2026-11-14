/* global document */
// The registration form's colour pickers (pages/register.ts): the extra places are rendered
// hidden and disabled, so they are not sent. "Add a colour" turns the first unused one on; "×"
// turns one off again. The server checks the colours whatever this script does.
for (const box of document.querySelectorAll('[data-colors]')) {
  const add = box.querySelector('[data-add-color]');
  const extras = [...box.querySelectorAll('[data-extra-color]')];
  const refresh = () => {
    add.hidden = extras.every((extra) => !extra.hidden);
  };
  const toggle = (extra, on) => {
    extra.hidden = !on;
    extra.querySelector('input').disabled = !on;
    refresh();
  };
  add.addEventListener('click', () => {
    const next = extras.find((extra) => extra.hidden);
    if (next) {
      toggle(next, true);
      next.querySelector('input').focus();
    }
  });
  for (const extra of extras) {
    extra.querySelector('[data-remove-color]').addEventListener('click', () => {
      toggle(extra, false);
      add.focus();
    });
  }
  refresh();
}
