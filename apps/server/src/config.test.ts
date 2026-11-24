import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const SECRET = 'MTIzNDU2Nzg5MDEyMzQ1Njc4.fake.token-value';
const valid = {
  DISCORD_TOKEN: SECRET,
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_GUILD_ID: '876543210987654321',
};

describe('loadConfig', () => {
  it('reads the Discord settings and defaults the database path, the assets folder and the log level', () => {
    expect(loadConfig(valid)).toEqual({
      ok: true,
      config: {
        discordToken: SECRET,
        discordClientId: '123456789012345678',
        discordGuildId: '876543210987654321',
        databasePath: './data/ligo.db',
        assetsDir: './data/assets/render',
        storageDir: './data/storage',
        parsersDir: './parsers/dist',
        logLevel: 'info',
        r2: null,
        web: {
          host: '127.0.0.1',
          port: 3000,
          publicUrl: 'http://localhost:3000',
          trustProxy: false,
          login: null,
        },
      },
    });
  });

  it('trusts a reverse proxy’s forwarded scheme only when told to', () => {
    expect(loadConfig({ ...valid, TRUST_PROXY: 'true' })).toMatchObject({
      ok: true,
      config: { web: { trustProxy: true } },
    });
    for (const off of ['false', '']) {
      expect(loadConfig({ ...valid, TRUST_PROXY: off })).toMatchObject({
        ok: true,
        config: { web: { trustProxy: false } },
      });
    }
    expect(loadConfig({ ...valid, TRUST_PROXY: 'yes' })).toEqual({
      ok: false,
      errors: ['TRUST_PROXY is not valid'],
    });
  });

  it('reads where the website listens, and refuses a port that is not one', () => {
    expect(loadConfig({ ...valid, HOST: '0.0.0.0', PORT: '8080' })).toMatchObject({
      ok: true,
      config: { web: { host: '0.0.0.0', port: 8080 } },
    });
    for (const port of ['0', '70000', 'http']) {
      expect(loadConfig({ ...valid, PORT: port })).toEqual({
        ok: false,
        errors: ['PORT is not valid'],
      });
    }
  });

  it('ignores unrelated environment variables', () => {
    expect(loadConfig({ ...valid, PATH: '/usr/bin', LOG_LEVEL: 'debug' })).toMatchObject({
      ok: true,
      config: { logLevel: 'debug' },
    });
  });

  it('reads the database path', () => {
    expect(loadConfig({ ...valid, DATABASE_PATH: '/var/lib/ligo/ligo.db' })).toMatchObject({
      ok: true,
      config: { databasePath: '/var/lib/ligo/ligo.db' },
    });
  });

  it.each(['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID'])(
    'reports a missing %s',
    (name) => {
      expect(loadConfig({ ...valid, [name]: undefined })).toEqual({
        ok: false,
        errors: [`${name} is missing`],
      });
      expect(loadConfig({ ...valid, [name]: '' })).toEqual({
        ok: false,
        errors: [`${name} is missing`],
      });
    },
  );

  it('reports every problem at once', () => {
    expect(loadConfig({ LOG_LEVEL: 'loud' })).toEqual({
      ok: false,
      errors: [
        'DISCORD_TOKEN is missing',
        'DISCORD_CLIENT_ID is missing',
        'DISCORD_GUILD_ID is missing',
        'LOG_LEVEL is not valid',
      ],
    });
  });

  it('turns login on with both secrets, and refuses one without the other', () => {
    const CLIENT = 'client-secret-0123456789';
    const SESSION = 's'.repeat(32);
    expect(
      loadConfig({
        ...valid,
        DISCORD_CLIENT_SECRET: CLIENT,
        SESSION_SECRET: SESSION,
        PUBLIC_URL: 'https://ligoleague.eu',
      }),
    ).toMatchObject({
      ok: true,
      config: {
        web: {
          publicUrl: 'https://ligoleague.eu',
          login: { clientSecret: CLIENT, sessionSecret: SESSION },
        },
      },
    });
    // Left empty in .env: not set.
    expect(loadConfig({ ...valid, DISCORD_CLIENT_SECRET: '', SESSION_SECRET: '' })).toMatchObject({
      ok: true,
      config: { web: { login: null } },
    });
    expect(loadConfig({ ...valid, DISCORD_CLIENT_SECRET: CLIENT })).toEqual({
      ok: false,
      errors: ['SESSION_SECRET is missing'],
    });
    expect(loadConfig({ ...valid, SESSION_SECRET: SESSION })).toEqual({
      ok: false,
      errors: ['DISCORD_CLIENT_SECRET is missing'],
    });
    const short = loadConfig({ ...valid, DISCORD_CLIENT_SECRET: CLIENT, SESSION_SECRET: 'short' });
    expect(short).toEqual({ ok: false, errors: ['SESSION_SECRET is not valid'] });
    expect(JSON.stringify(short)).not.toContain(CLIENT);
    expect(loadConfig({ ...valid, PUBLIC_URL: 'ftp://example.com' })).toEqual({
      ok: false,
      errors: ['PUBLIC_URL is not valid'],
    });
  });

  it('stores files in R2 with all four settings, and on disk with none', () => {
    const R2 = {
      R2_ACCOUNT_ID: 'acc0unt',
      R2_ACCESS_KEY_ID: 'AKIDEXAMPLE',
      R2_SECRET_ACCESS_KEY: 'r2-secret-never-in-an-error',
      R2_BUCKET: 'ligo',
    };
    expect(loadConfig({ ...valid, ...R2 })).toMatchObject({
      ok: true,
      config: {
        r2: {
          accountId: 'acc0unt',
          accessKeyId: 'AKIDEXAMPLE',
          secretAccessKey: R2.R2_SECRET_ACCESS_KEY,
          bucket: 'ligo',
          endpoint: null,
        },
      },
    });
    expect(
      loadConfig({ ...valid, ...R2, R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com' }),
    ).toMatchObject({
      ok: true,
      config: { r2: { endpoint: 'https://example.r2.cloudflarestorage.com' } },
    });
    // Left empty in .env: not set.
    expect(loadConfig({ ...valid, R2_BUCKET: '', R2_ACCOUNT_ID: '' })).toMatchObject({
      ok: true,
      config: { r2: null },
    });
    const partial = loadConfig({ ...valid, ...R2, R2_BUCKET: '' });
    expect(partial).toEqual({ ok: false, errors: ['R2_BUCKET is missing'] });
    expect(JSON.stringify(partial)).not.toContain(R2.R2_SECRET_ACCESS_KEY);
  });

  it('never repeats a value in an error, so a secret pasted in the wrong variable stays out of logs', () => {
    const result = loadConfig({
      ...valid,
      DISCORD_CLIENT_ID: SECRET,
      DISCORD_GUILD_ID: 'my server',
    });
    expect(result).toEqual({
      ok: false,
      errors: ['DISCORD_CLIENT_ID is not valid', 'DISCORD_GUILD_ID is not valid'],
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});
