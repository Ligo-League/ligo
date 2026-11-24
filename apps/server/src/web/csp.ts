// The Content-Security-Policy of the website's pages (design doc section 13): scripts, styles
// and connections from this site only. The replay uploader adds what it needs: WebAssembly for
// the parser, and the R2 address its raw files are sent to.

export interface PolicyExtras {
  /** `'wasm-unsafe-eval'`: the parser is WebAssembly, compiled in the page's Web Worker. */
  wasm?: boolean;
  /** Origins the page may send requests to, beyond this site. */
  connect?: readonly string[];
}

export function contentSecurityPolicy(extras: PolicyExtras = {}): string {
  return [
    "default-src 'self'",
    `script-src 'self'${extras.wasm ? " 'wasm-unsafe-eval'" : ''}`,
    // Inline style attributes carry team colours.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    ...(extras.connect && extras.connect.length > 0
      ? [`connect-src 'self' ${extras.connect.join(' ')}`]
      : []),
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; ');
}
