/**
 * Odoo 18 EE JSON-RPC Client
 *
 * All communication with Odoo happens through this class.
 * Uses JSON-RPC over HTTP — no custom modules needed on Odoo.
 *
 * Usage:
 *   const odoo = new OdooClient();
 *   await odoo.authenticate();
 *   const boms = await odoo.searchRead('mrp.bom', [], ['product_tmpl_id', 'product_qty']);
 */

import { cookies } from 'next/headers';

const ODOO_URL = process.env.ODOO_URL || 'http://89.167.124.0:15069';
const ODOO_DB = process.env.ODOO_DB || 'krawings';
const ODOO_USER = process.env.ODOO_USER || '';
const ODOO_PASSWORD = process.env.ODOO_PASSWORD || '';

export const PORTAL_LANG_COOKIE = 'portal_lang';
export type PortalLang = 'en_US' | 'de_DE';

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data: { message: string; debug: string };
  };
}

export class OdooClient {
  private url: string;
  private db: string;
  private uid: number | null = null;
  private password: string;
  private sessionId: string | null = null;
  private allowedCompanyIds: number[] = [];

  constructor(
    url: string = ODOO_URL,
    db: string = ODOO_DB,
  ) {
    this.url = url;
    this.db = db;
    this.password = ODOO_PASSWORD;
  }

  /**
   * Raw JSON-RPC call
   */
  private async rpc(endpoint: string, params: Record<string, any>, _retried = false): Promise<any> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.sessionId) {
      headers['Cookie'] = `session_id=${this.sessionId}`;
    }

    // Bound every RPC — through response-body parsing, not just headers — with a
    // timeout so a hung Odoo can't block the request forever.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let data: JsonRpcResponse;
    try {
      const response = await fetch(`${this.url}${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'call',
          params,
        }),
        signal: controller.signal,
      });

      // Capture session cookie
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        const match = setCookie.match(/session_id=([^;]+)/);
        if (match) this.sessionId = match[1];
      }

      data = await response.json();
    } finally {
      clearTimeout(timer);
    }

    if (data.error) {
      // Retry once on session expiry (Odoo returns 100 for SessionExpired)
      const code = data.error.code;
      const msg = (data.error.data?.message || '').toLowerCase();
      if (!_retried && (code === 100 || msg.includes('session') || msg.includes('odoo.http.SessionExpiredException'))) {
        console.warn('[OdooClient] Session expired, re-authenticating...');
        this.uid = null;
        this.sessionId = null;
        await this.authenticate();
        return this.rpc(endpoint, params, true);
      }
      // Retry once on a stale company cache. This client is a long-lived singleton
      // that captures allowed_company_ids at auth time and stamps them onto every
      // request. If a company is archived or reassigned in Odoo afterwards, Odoo
      // rejects every call with "Access to unauthorized or invalid companies" until
      // the process restarts. Re-authenticate to refresh the list, rewrite the
      // company ids already baked into this request's context, and retry once.
      if (!_retried && msg.includes('unauthorized or invalid companies')) {
        console.warn('[OdooClient] Stale company cache — re-authenticating to refresh allowed companies...');
        this.uid = null;
        this.sessionId = null;
        await this.authenticate();
        const ctx = params?.kwargs?.context;
        if (ctx && typeof ctx === 'object') {
          if (this.allowedCompanyIds.length > 0) ctx.allowed_company_ids = this.allowedCompanyIds;
          else delete ctx.allowed_company_ids;
        }
        return this.rpc(endpoint, params, true);
      }
      throw new Error(
        `Odoo RPC Error: ${data.error.message} — ${data.error.data?.message || ''}`
      );
    }

    return data.result;
  }

  /**
   * Authenticate with Odoo
   */
  async authenticate(
    user: string = ODOO_USER,
    password: string = ODOO_PASSWORD,
  ): Promise<number> {
    this.password = password;
    const result = await this.rpc('/web/session/authenticate', {
      db: this.db,
      login: user,
      password,
    });
    this.uid = result.uid;
    if (!this.uid) {
      throw new Error('Authentication failed — invalid credentials');
    }

    // Capture all allowed company IDs from session
    // Odoo 18: result.user_companies.allowed_companies is { id: {id, name, ...}, ... }
    try {
      const uc = result.user_companies;
      if (uc?.allowed_companies) {
        this.allowedCompanyIds = Object.keys(uc.allowed_companies).map(Number);
      }
      if (this.allowedCompanyIds.length === 0 && uc?.current_company) {
        this.allowedCompanyIds = [uc.current_company];
      }
      console.log('[OdooClient] allowed_company_ids:', this.allowedCompanyIds);
    } catch {
      console.warn('[OdooClient] Could not parse user_companies from session');
    }

    return this.uid;
  }

  /**
   * Ensure we have an active session
   */
  private async ensureAuth(): Promise<void> {
    if (!this.uid) {
      await this.authenticate();
    }
  }

  /**
   * Build default context with company access.
   * Reads `portal_lang` cookie so product names (and other translated fields)
   * come back in the current user's language. Falls back to en_US when the
   * cookie is absent or cookies() is unavailable (e.g. background jobs).
   */
  private getContext(extra: Record<string, any> = {}): Record<string, any> {
    let lang = 'en_US';
    try {
      const value = cookies().get(PORTAL_LANG_COOKIE)?.value;
      if (value === 'de_DE' || value === 'en_US') lang = value;
    } catch { /* outside request scope — keep default */ }

    return {
      lang,
      tz: 'Europe/Berlin',
      ...(this.allowedCompanyIds.length > 0 ? { allowed_company_ids: this.allowedCompanyIds } : {}),
      ...extra,
    };
  }

  /**
   * Call a model method via JSON-RPC
   */
  async call(
    model: string,
    method: string,
    args: any[] = [],
    kwargs: Record<string, any> = {},
  ): Promise<any> {
    await this.ensureAuth();
    return this.rpc('/web/dataset/call_kw', {
      model,
      method,
      args,
      kwargs: {
        context: this.getContext(kwargs.context || {}),
        ...Object.fromEntries(Object.entries(kwargs).filter(([k]) => k !== 'context')),
      },
    });
  }

  /**
   * search_read — the workhorse for listing records
   */
  async searchRead(
    model: string,
    domain: any[] = [],
    fields: string[] = [],
    options: {
      limit?: number;
      offset?: number;
      order?: string;
      context?: Record<string, any>;
    } = {},
  ): Promise<any[]> {
    await this.ensureAuth();
    return this.rpc('/web/dataset/call_kw', {
      model,
      method: 'search_read',
      args: [domain],
      kwargs: {
        fields,
        limit: options.limit || 200,
        offset: options.offset || 0,
        order: options.order || '',
        context: this.getContext(options.context || {}),
      },
    });
  }

  /**
   * search_read, ALL of it — pages by an id CURSOR until done.
   *
   * Exists because `searchRead({ limit: 0 })` does NOT mean "no limit": 0 is
   * falsy, so the client quietly substitutes 200 and callers get the first 200
   * rows sorted however they asked, with no error. That silent cap starved the
   * Prep Planner's demand backfill for months. Use THIS whenever the intent is
   * "every matching row".
   *
   * Cursor, not offset, on purpose: an offset walk over a live table repeats
   * or skips rows when records land mid-run; `id > last` cannot. The price:
   * results come back ordered by id — sort in memory if you need another order.
   *
   * `maxRows` is a runaway backstop, and hitting it THROWS: returning a
   * silently truncated "everything" would recreate the exact bug this method
   * exists to fix. Raise it deliberately when a dataset is genuinely bigger.
   */
  async searchReadAll(
    model: string,
    domain: any[] = [],
    fields: string[] = [],
    options: { context?: Record<string, any>; pageSize?: number; maxRows?: number } = {},
  ): Promise<any[]> {
    const pageSize = options.pageSize || 500;
    const maxRows = options.maxRows || 50_000;
    const all: any[] = [];
    let cursor = 0;
    for (;;) {
      const page = await this.searchRead(model, [...domain, ['id', '>', cursor]], fields, {
        limit: pageSize,
        order: 'id asc',
        context: options.context,
      });
      all.push(...page);
      // Over the backstop in ANY case — including a short final page that
      // lands past it (non-aligned pageSize/maxRows must not slip through).
      if (all.length > maxRows || (all.length >= maxRows && page.length === pageSize)) {
        throw new Error(
          `searchReadAll(${model}) exceeded the ${maxRows}-row backstop — refusing to return truncated data; raise maxRows deliberately`,
        );
      }
      if (page.length < pageSize) return all;
      cursor = page[page.length - 1].id;
    }
  }

  /**
   * read — fetch specific record IDs
   */
  async read(
    model: string,
    ids: number[],
    fields: string[] = [],
  ): Promise<any[]> {
    return this.call(model, 'read', [ids, fields]);
  }

  /**
   * create — create a new record
   */
  async create(
    model: string,
    vals: Record<string, any>,
    kwargs: Record<string, any> = {},
  ): Promise<number> {
    return this.call(model, 'create', [vals], kwargs);
  }

  /**
   * write — update existing records
   */
  async write(
    model: string,
    ids: number[],
    vals: Record<string, any>,
  ): Promise<boolean> {
    return this.call(model, 'write', [ids, vals]);
  }

  /**
   * unlink — delete records
   */
  async unlink(model: string, ids: number[]): Promise<boolean> {
    return this.call(model, 'unlink', [ids]);
  }

  /**
   * Get the allowed company IDs for the authenticated user
   */
  getAllowedCompanyIds(): number[] {
    return [...this.allowedCompanyIds];
  }

  /**
   * Execute a button/action method on records
   */
  async buttonCall(
    model: string,
    method: string,
    ids: number[],
  ): Promise<any> {
    return this.call(model, method, [ids]);
  }
}

// Singleton instance for API routes
let _instance: OdooClient | null = null;

export function getOdoo(): OdooClient {
  if (!_instance) {
    _instance = new OdooClient();
  }
  return _instance;
}

/** Force re-authentication on next call (e.g. after company changes) */
export function resetOdooSession(): void {
  _instance = null;
}

/**
 * Convenience wrapper: odooRPC(model, method, args) → getOdoo().call(...)
 * Used by manufacturing-orders package route and other API routes.
 */
export async function odooRPC(
  model: string,
  method: string,
  args: any[] = [],
  kwargs: Record<string, any> = {},
): Promise<any> {
  return getOdoo().call(model, method, args, kwargs);
}
