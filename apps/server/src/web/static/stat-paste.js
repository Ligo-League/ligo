/* global document, Event */
// The stat grid's paste (pages/match-stats.ts): rows copied from a spreadsheet, pasted into a
// cell, fill the grid from that cell, right then down; a single value pastes as usual. The grid
// then checks itself again (htmx listens for `input`). The server checks every value whatever
// this script does.
for (const grid of document.querySelectorAll('[data-stat-grid]')) {
  grid.addEventListener('paste', (event) => {
    const start = event.target.closest('input[data-row]');
    const text = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
    if (!start || !/[\t\n]/.test(text.trim())) return;
    event.preventDefault();
    const lines = text
      .replace(/\r/g, '')
      .replace(/\n+$/, '')
      .split('\n')
      .map((line) => line.split('\t'));
    const row = Number(start.dataset.row);
    const col = Number(start.dataset.col);
    lines.forEach((cells, i) => {
      cells.forEach((value, j) => {
        const input = grid.querySelector(
          `input[data-row="${String(row + i)}"][data-col="${String(col + j)}"]`,
        );
        if (input) input.value = value.trim();
      });
    });
    start.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
