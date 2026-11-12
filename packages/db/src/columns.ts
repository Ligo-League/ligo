import { sql, type SQL } from 'drizzle-orm';
import { customType, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';

/**
 * A `*_json` column: TEXT in SQLite, validated by its zod schema on every write and every read
 * (design doc section 4, "Conventions"). Invalid data throws instead of reaching the caller.
 */
export function jsonText<S extends z.ZodType>(schema: S) {
  return customType<{ data: z.output<S>; driverData: string }>({
    dataType: () => 'text',
    toDriver: (value) => JSON.stringify(schema.parse(value)),
    fromDriver: (value) => schema.parse(JSON.parse(value)),
  });
}

/**
 * CHECK expression for an enum column. Drizzle's `text({ enum })` only types the column;
 * this makes SQLite refuse other values too. Values are inlined because DDL takes no parameters.
 */
export function oneOf(column: AnySQLiteColumn, values: readonly string[]): SQL {
  const list = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ');
  return sql`${column} in (${sql.raw(list)})`;
}

/** CHECK expression for a calendar date stored as `YYYY-MM-DD` text. */
export function isIsoDate(column: AnySQLiteColumn): SQL {
  return sql`${column} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`;
}
