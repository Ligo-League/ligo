import { acceptsR6, R6_HEAD_BYTES, sha256Hex, type Parser } from '@ligo/parsers';
import { browserParser } from '@ligo/parsers/browser';
import { normalizeR6, type R6Unit } from '@ligo/titles';
import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { createReplayApi, type FileToSubmit, type SubmitOutcome } from './api.ts';
import {
  format,
  uploaderConfigSchema,
  type KnownAccount,
  type UploaderConfig,
  type UploaderMessage,
} from './config.ts';
import { groupFolders, inWindow, type FolderTime, type Recording } from './folders.ts';
import { previewLobbies, type LobbyPreview } from './lobbies.ts';
import { submitBatches, uploadRaw, type UploadStatus } from './upload.ts';

// The replay uploader (design doc section 8, upload flow 1 to 5), the website's one Preact island
// (`/matches/:id/replays`). The player picks their replay folder; the page reads the round files
// around the match one at a time, in a Web Worker running the same parser as the server, shows
// the lobbies found, and on confirmation sends the rounds' JSON, then the raw files, 3 at a time.

interface Picked {
  path: string;
  name: string;
  size: number;
  file: File;
}

interface ReadRound {
  file: File;
  sha256: string;
  round: unknown;
  unit: R6Unit;
}

type Phase =
  | { kind: 'pick' }
  | { kind: 'choose'; recordings: Recording<Picked>[]; chosen: Set<string> }
  | { kind: 'parsing'; done: number; total: number }
  | { kind: 'preview'; rounds: ReadRound[]; failed: string[] }
  | { kind: 'sending' }
  | {
      kind: 'uploading' | 'done';
      outcomes: SubmitOutcome[];
      /** The picked files by SHA-256, kept to send a failed one again. */
      files: Map<string, File>;
      statuses: Map<number, UploadStatus>;
      progress: Map<number, number>;
    }
  | { kind: 'reload' }
  | { kind: 'error' };

const localTime = (time: FolderTime | null) =>
  time &&
  new Date(time.year, time.month - 1, time.day, time.hour, time.minute, time.second).getTime();

async function accountHash(account: string) {
  return sha256Hex(new TextEncoder().encode(account.toLowerCase()));
}

function Uploader({ config }: { config: UploaderConfig }) {
  const m = (key: UploaderMessage, values?: Record<string, string | number>) =>
    format(config.messages[key], values);
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' });
  const [known, setKnown] = useState(new Map<string, KnownAccount>());
  const api = useMemo(() => createReplayApi(config.matchId, config.csrf), [config]);
  const dates = new Intl.DateTimeFormat(document.documentElement.lang || 'fr', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  // Leaving while files are read or sent loses them: the browser asks first.
  const busy = phase.kind === 'parsing' || phase.kind === 'sending' || phase.kind === 'uploading';
  useEffect(() => {
    if (!busy) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [busy]);

  const pick = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? [], (file) => ({
      path: file.webkitRelativePath,
      name: file.name,
      size: file.size,
      file,
    }));
    const recordings = groupFolders(files);
    const chosen = new Set(
      recordings.filter((r) => inWindow(localTime(r.time), config.window)).map((r) => r.folder),
    );
    setPhase({ kind: 'choose', recordings, chosen });
  };

  const read = async (files: Picked[]) => {
    setPhase({ kind: 'parsing', done: 0, total: files.length });
    let parser: Parser | null = null;
    const rounds: ReadRound[] = [];
    const failed: string[] = [];
    const hashes = new Map(config.known.map((entry) => [entry.hash, entry]));
    const found = new Map<string, KnownAccount>();
    try {
      parser = browserParser(
        { title: 'r6', version: config.parser.version },
        () => new Worker(config.parser.worker),
        { wasm: config.parser.wasm },
      );
      for (const [index, picked] of files.entries()) {
        const bytes = new Uint8Array(await picked.file.arrayBuffer());
        if (!acceptsR6(picked.name, bytes.subarray(0, R6_HEAD_BYTES))) {
          failed.push(picked.name);
        } else {
          const [sha256, outcome] = await Promise.all([sha256Hex(bytes), parser.parse(bytes)]);
          const round: unknown = outcome.ok ? JSON.parse(outcome.json) : null;
          const unit = outcome.ok
            ? normalizeR6(round, {
                parser: config.parser.version,
                fileSha256: sha256,
                tradeWindowS: config.tradeWindowS,
              })
            : null;
          if (unit?.ok) {
            rounds.push({ file: picked.file, sha256, round, unit: unit.unit });
            for (const player of unit.unit.players) {
              if (!player.account || found.has(player.account)) continue;
              const entry = hashes.get(await accountHash(player.account));
              if (entry) found.set(player.account, entry);
            }
          } else {
            failed.push(picked.name);
          }
        }
        setPhase({ kind: 'parsing', done: index + 1, total: files.length });
      }
      setKnown(found);
      setPhase({ kind: 'preview', rounds, failed });
    } catch {
      setPhase({ kind: 'error' });
    } finally {
      await parser?.close();
    }
  };

  const upload = async (
    outcomes: SubmitOutcome[],
    files: Map<string, File>,
    previous?: Map<number, UploadStatus>,
  ) => {
    const toSend = outcomes.flatMap((outcome) =>
      (outcome.status === 'stored' ||
        (outcome.status === 'duplicate' &&
          (outcome.raw === 'none' || outcome.raw === 'uploading'))) &&
      previous?.get(outcome.id) !== 'stored'
        ? [outcome.id]
        : [],
    );
    const fileOf = new Map(
      outcomes.flatMap((o) =>
        o.status === 'refused' ? [] : [[o.id, files.get(o.sha256)] as const],
      ),
    );
    const statuses = new Map(previous);
    const progress = new Map<number, number>();
    const show = (kind: 'uploading' | 'done') => {
      setPhase({
        kind,
        outcomes,
        files,
        statuses: new Map(statuses),
        progress: new Map(progress),
      });
    };
    show('uploading');
    await uploadRaw(toSend, {
      sign: (ids) => api.sign(ids),
      stored: (ids) => api.stored(ids),
      put: (id, link, onProgress) => {
        const file = fileOf.get(id);
        return file ? api.put(link, file, onProgress) : Promise.resolve('failed');
      },
      onProgress: (id, fraction) => {
        progress.set(id, fraction);
        show('uploading');
      },
      onStatus: (id, status) => {
        statuses.set(id, status);
        show('uploading');
      },
    });
    show('done');
  };

  const send = async (rounds: ReadRound[]) => {
    setPhase({ kind: 'sending' });
    const files = new Map(rounds.map((r) => [r.sha256, r.file]));
    const wire: FileToSubmit[] = rounds.map((r) => ({
      name: r.file.name,
      size: r.file.size,
      sha256: r.sha256,
      round: r.round,
    }));
    const outcomes: SubmitOutcome[] = [];
    try {
      for (const batch of submitBatches(wire)) {
        const reply = await api.submit(config.parser.version, batch);
        if (!reply.ok) {
          setPhase({ kind: reply.error === 'parser_version' ? 'reload' : 'error' });
          return;
        }
        outcomes.push(...reply.files);
      }
      await upload(outcomes, files);
    } catch {
      setPhase({ kind: 'error' });
    }
  };

  if (phase.kind === 'pick') {
    return (
      <div class="card">
        <label>
          {m('pick')}{' '}
          <input
            type="file"
            multiple
            ref={(input) => input?.setAttribute('webkitdirectory', '')}
            onChange={(event) => {
              pick(event.currentTarget);
            }}
          />
        </label>
        <p class="muted">{m('pickHelp')}</p>
      </div>
    );
  }

  if (phase.kind === 'choose') {
    const { recordings, chosen } = phase;
    if (recordings.length === 0) {
      return <p class="card flash error">{m('noFolders')}</p>;
    }
    const toggle = (folder: string) => {
      const next = new Set(chosen);
      if (!next.delete(folder)) next.add(folder);
      setPhase({ kind: 'choose', recordings, chosen: next });
    };
    const files = recordings.filter((r) => chosen.has(r.folder)).flatMap((r) => r.files);
    return (
      <div class="card">
        <ul class="replay-folders">
          {recordings.map((recording) => {
            const time = localTime(recording.time);
            return (
              <li key={recording.folder}>
                <label>
                  <input
                    type="checkbox"
                    checked={chosen.has(recording.folder)}
                    onChange={() => {
                      toggle(recording.folder);
                    }}
                  />{' '}
                  {m('folder', { date: time === null ? recording.folder : dates.format(time) })}{' '}
                  <span class="muted">
                    {m('folderRounds', { n: recording.files.length })}
                    {inWindow(time, config.window) ? '' : ` · ${m('outsideWindow')}`}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          disabled={files.length === 0}
          onClick={() => {
            void read(files);
          }}
        >
          {m('parse')}
        </button>
      </div>
    );
  }

  if (phase.kind === 'parsing') {
    return (
      <div class="card">
        <p>{m('parsing', { done: phase.done, total: phase.total })}</p>
        <progress max={phase.total} value={phase.done} />
      </div>
    );
  }

  if (phase.kind === 'preview') {
    const lobbies = previewLobbies(
      phase.rounds.map((r) => r.unit),
      (account) => known.get(account),
      config.minKnown,
    );
    const { rounds, failed } = phase;
    return (
      <div>
        {lobbies.map((lobby) => (
          <LobbyCard key={lobby.lobbyId} lobby={lobby} config={config} m={m} dates={dates} />
        ))}
        {failed.length > 0 && (
          <p class="card flash error">
            {m('parseFailed', { n: failed.length })} <span class="muted">{failed.join(', ')}</span>
          </p>
        )}
        <button
          type="button"
          disabled={rounds.length === 0}
          onClick={() => {
            void send(rounds);
          }}
        >
          {m('send', { n: rounds.length })}
        </button>
      </div>
    );
  }

  if (phase.kind === 'sending') return <p class="card">{m('sending')}</p>;
  if (phase.kind === 'reload') {
    return (
      <p class="card flash error">
        {m('parserChanged')}{' '}
        <button
          type="button"
          onClick={() => {
            window.location.reload();
          }}
        >
          {m('reload')}
        </button>
      </p>
    );
  }
  if (phase.kind === 'error') {
    return (
      <p class="card flash error">
        {m('error')} <a href={config.matchUrl}>{m('back')}</a>
      </p>
    );
  }

  const { outcomes, files, statuses, progress } = phase;
  const nameOf = (sha256: string) => files.get(sha256)?.name ?? sha256.slice(0, 12);
  const refused = outcomes.flatMap((o) => (o.status === 'refused' ? [o] : []));
  const ids = [...statuses.keys()];
  const stored = ids.filter((id) => statuses.get(id) === 'stored').length;
  const failed = ids.filter((id) => statuses.get(id) === 'failed').length;
  const sent = ids.reduce(
    (sum, id) => sum + (statuses.get(id) === 'stored' ? 1 : (progress.get(id) ?? 0)),
    0,
  );
  return (
    <div class="card">
      <p>
        {phase.kind === 'uploading' ? m('uploading') : m('done')}{' '}
        {m('uploaded', { done: stored, total: ids.length })}
      </p>
      {phase.kind === 'uploading' && <progress max={Math.max(ids.length, 1)} value={sent} />}
      {refused.length > 0 && (
        <ul class="flash error">
          {refused.map((outcome) => (
            <li key={outcome.sha256}>
              {nameOf(outcome.sha256)} : {m(refusedKey(outcome.error))}
            </li>
          ))}
        </ul>
      )}
      {phase.kind === 'done' && failed > 0 && (
        <p class="flash error">
          {m('status.failed', { n: failed })}{' '}
          <button
            type="button"
            onClick={() => {
              // Only the files not stored yet go again.
              void upload(outcomes, files, statuses);
            }}
          >
            {m('retry')}
          </button>
        </p>
      )}
      {phase.kind === 'done' && <a href={config.matchUrl}>{m('back')}</a>}
    </div>
  );
}

type MossState = 'sent' | 'missing' | 'sending' | 'failed' | 'tooLarge';

/** MOSS files (M-47): one per player the replays show, each sent on its own, staff-only. */
function MossPanel({ config }: { config: UploaderConfig }) {
  const m = (key: UploaderMessage, values?: Record<string, string | number>) =>
    format(config.messages[key], values);
  const api = useMemo(() => createReplayApi(config.matchId, config.csrf), [config]);
  const moss = config.moss;
  const [states, setStates] = useState(
    new Map<number, MossState>(
      (moss?.players ?? []).map((p) => [p.playerId, p.hasFile ? 'sent' : 'missing']),
    ),
  );
  const [progress, setProgress] = useState(new Map<number, number>());
  if (!moss) return null;
  const set = (playerId: number, state: MossState) => {
    setStates((before) => new Map(before).set(playerId, state));
  };
  const send = async (playerId: number, file: File) => {
    if (file.size > moss.maxBytes) {
      set(playerId, 'tooLarge');
      return;
    }
    set(playerId, 'sending');
    try {
      const link = await api.mossSign(playerId, file.name, file.size);
      const put = link.ok
        ? await api.put(link, file, (fraction) => {
            setProgress((before) => new Map(before).set(playerId, fraction));
          })
        : 'failed';
      const stored = link.ok && put === 'ok' && (await api.mossStored(playerId, link.key));
      set(playerId, stored ? 'sent' : 'failed');
    } catch {
      set(playerId, 'failed');
    }
  };
  return (
    <section class="card">
      <h2>{m('moss.title')}</h2>
      <p class="muted">{m('moss.help')}</p>
      {moss.players.length === 0 ? (
        <p>{m('moss.none')}</p>
      ) : (
        <ul class="moss-players">
          {moss.players.map((player) => {
            const state = states.get(player.playerId) ?? 'missing';
            return (
              <li key={player.playerId}>
                <strong>{player.name}</strong> ({config.teams[player.side].tag}) :{' '}
                {m(`moss.${state}`)}{' '}
                {state === 'sending' ? (
                  <progress max={1} value={progress.get(player.playerId) ?? 0} />
                ) : (
                  <input
                    type="file"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void send(player.playerId, file);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const REFUSED = ['not_a_replay', 'invalid', 'not_bomb', 'not_this_match', 'other_match'] as const;
const refusedKey = (error: string): UploaderMessage =>
  // An answer this page does not know reads as unreadable.
  `refused.${REFUSED.find((known) => known === error) ?? 'invalid'}`;

function LobbyCard(props: {
  lobby: LobbyPreview;
  config: UploaderConfig;
  m: (key: UploaderMessage, values?: Record<string, string | number>) => string;
  dates: Intl.DateTimeFormat;
}) {
  const { lobby, config, m, dates } = props;
  const tag = (side: 'a' | 'b' | null) => (side ? config.teams[side].tag : '?');
  const resolved = lobby.sides.some((side) => side.team !== null);
  return (
    <section class="card">
      <h3>
        {m('lobby', {
          map: lobby.map,
          date: lobby.startedAt === null ? '' : dates.format(lobby.startedAt),
        })}
      </h3>
      <p class="muted">{m('lobbyRounds', { n: lobby.rounds.length })}</p>
      {!lobby.customGame && <p class="flash error">{m('notCustom')}</p>}
      {!resolved && <p class="flash error">{m('unknownTeams')}</p>}
      <ol class="replay-rounds">
        {lobby.rounds.map((round) => (
          <li key={round.number}>
            {m('round', { n: round.number + 1 })} :{' '}
            {round.complete ? tag(round.winner) : m('roundCut')}
          </li>
        ))}
      </ol>
      <div class="replay-sides">
        {lobby.sides.map((side, index) => (
          <ul key={index}>
            <li>
              <strong>{side.team ? config.teams[side.team].name : '?'}</strong>
            </li>
            {side.players.map((player) => (
              <li key={player.name}>
                {player.name}{' '}
                <span class="muted">
                  {player.known ? `(${player.known.name})` : m('unknownPlayer')}
                </span>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </section>
  );
}

// The page holds the configuration in a data attribute; the island replaces the explanation
// shown without scripts.
const root = document.getElementById('replay-uploader');
const parsed = uploaderConfigSchema.safeParse(JSON.parse(root?.dataset.config ?? 'null'));
if (root && parsed.success) {
  root.replaceChildren();
  render(
    <>
      <Uploader config={parsed.data} />
      <MossPanel config={parsed.data} />
    </>,
    root,
  );
}
