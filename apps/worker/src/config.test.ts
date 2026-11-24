import { describe, expect, it } from 'vitest';
import { loadWorkerConfig } from './config.ts';

// The worker's settings (design doc section 13): the database it shares with the server, where
// files live, and the parser build. It needs no Discord token: only the server talks to Discord.

const R2 = {
  R2_ACCOUNT_ID: 'acc0unt',
  R2_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  R2_SECRET_ACCESS_KEY: 'r2-secret-never-in-an-error',
  R2_BUCKET: 'ligo',
};

describe('loadWorkerConfig', () => {
  it('defaults to the local files, with no R2', () => {
    expect(loadWorkerConfig({})).toEqual({
      ok: true,
      config: {
        databasePath: './data/ligo.db',
        storageDir: './data/storage',
        parsersDir: './parsers/dist',
        logLevel: 'info',
        r2: null,
      },
    });
  });

  it('reads R2 with all four settings, and names a missing one without any value', () => {
    expect(loadWorkerConfig(R2)).toMatchObject({
      ok: true,
      config: { r2: { accountId: 'acc0unt', bucket: 'ligo', endpoint: null } },
    });
    const partial = loadWorkerConfig({ ...R2, R2_BUCKET: '' });
    expect(partial).toEqual({ ok: false, errors: ['R2_BUCKET is missing'] });
    expect(JSON.stringify(partial)).not.toContain(R2.R2_SECRET_ACCESS_KEY);
  });
});
