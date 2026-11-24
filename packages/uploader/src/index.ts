// The replay uploader (design doc section 8, phase 5-9): the browser code the server bundles for
// `/matches/:id/replays`. The server reads only its configuration contract from here; the island
// (`./island`) and the parser's Web Worker (`./worker`) run in the browser.

export * from './config.ts';
