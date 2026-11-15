import type { Context } from 'hono';
import type { Env, Viewer, WebDeps } from './app.ts';
import type { Page } from './layout.ts';

// What `createWebApp` lends the route modules that live in their own files.

/** What the app lends its routes. */
export interface RouteKit {
  deps: WebDeps;
  render: (
    c: Context<Env>,
    page: Page,
    status?: 200 | 400 | 403 | 404 | 413 | 500 | 502,
  ) => Response | Promise<Response>;
  notFound: (c: Context<Env>) => Response | Promise<Response>;
  forbidden: (c: Context<Env>) => Response | Promise<Response>;
  guard: (c: Context<Env>) => Promise<{ viewer: Viewer; form: Record<string, unknown> } | Response>;
}
