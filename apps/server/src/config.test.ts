import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const SECRET = 'MTIzNDU2Nzg5MDEyMzQ1Njc4.fake.token-value';
const valid = {
  DISCORD_TOKEN: SECRET,
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_GUILD_ID: '876543210987654321',
};

describe('loadConfig', () => {
  it('reads the Discord settings and defaults the database path and the log level', () => {
    expect(loadConfig(valid)).toEqual({
      ok: true,
      config: {
        discordToken: SECRET,
        discordClientId: '123456789012345678',
        discordGuildId: '876543210987654321',
        databasePath: './data/ligo.db',
        logLevel: 'info',
      },
    });
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
