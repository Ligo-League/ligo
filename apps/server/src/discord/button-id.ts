// Button custom IDs are `action:entityId:nonce` (design doc section 6). The ID only says what
// was clicked: the handler re-reads permissions and the entity's current state from the database.

export interface ButtonTarget {
  action: string;
  entityId: number;
  /** Ties the button to one version of the entity, so a button from an older message is stale. */
  nonce: string;
}

const PATTERN = /^([a-z][a-z-]*):([1-9]\d{0,14}):([A-Za-z0-9]{1,32})$/;

export function buttonId(action: string, entityId: number, nonce: string | number): string {
  const id = `${action}:${entityId}:${nonce}`;
  // A malformed ID would produce a button nothing can handle: a programmer error.
  if (!PATTERN.test(id)) throw new Error(`Not a valid button ID: "${id}"`);
  return id;
}

/** The parts of a custom ID, or null for one this bot did not write. */
export function parseButtonId(customId: string): ButtonTarget | null {
  const match = PATTERN.exec(customId);
  if (!match) return null;
  const [, action = '', entityId = '', nonce = ''] = match;
  return { action, entityId: Number(entityId), nonce };
}
