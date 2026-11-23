// Replay parsers (design doc section 10): each title's parser is compiled to WebAssembly and runs
// the same in the uploader's browser (a Web Worker) and on the server (a Node worker thread), so
// the server can parse a raw file again and compare with the JSON a browser sent. This package
// loads and runs them; turning their output into Ligo's format is `@ligo/titles` (normalisers).

export type ParserTitle = 'r6';

/** One parser build: its title and its version, the start of its file's SHA-256. */
export interface ParserBuild {
  title: ParserTitle;
  /** `r6-<hash>`: the same source gives the same file, so the name is the version. */
  version: string;
}

/** A file's parse: the parser's own JSON text, or why it failed. */
export type ParseOutcome =
  | { ok: true; json: string }
  | {
      ok: false;
      /**
       * `not_a_replay`: refused before parsing (name or first bytes); `parse_failed`: the parser
       * refused the file; `timeout` and `memory`: the parser was stopped; `crashed`: it died.
       */
      error: 'not_a_replay' | 'parse_failed' | 'timeout' | 'memory' | 'crashed';
      message: string;
    };

/** A parser ready to take files, wherever it runs. */
export interface Parser extends ParserBuild {
  /** Whether a file is one this parser reads, from its name and first bytes. */
  accepts(name: string, head: Uint8Array): boolean;
  parse(bytes: Uint8Array): Promise<ParseOutcome>;
  /** Stops the parser and frees its memory; `parse` fails afterwards. */
  close(): Promise<void>;
}
