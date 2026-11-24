// The Web Worker the uploader parses replays in: the server's bundle puts Go's `wasm_exec.js`
// first (it defines `globalThis.Go`), then this, which answers the page's parse requests with
// the R6 parser (`@ligo/parsers`, design doc section 8).
import '@ligo/parsers/browser-worker';
