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

const ODOO_URL = process.env.ODOO_URL || 'http://89.167.124.0:15069';
const ODOO_DB = process.env.ODOO_DB || 'krawings';
const ODOO_USER = process.env.ODOO_USER || 'biz@krawings.de';
const ODOO_PASSWORD = process.env.ODOO_PASSWORD || '';

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
  private async rpc(endpoint: string, params: Record<string, any>): Promise<any> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.sessionId) {
      headers['Cookie'] = `session_id=${this.sessionId}`;
    }

    const response = await fetch(`${this.url}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'call',
        params,
      }),
    });

    // Capture session cookie
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      const match = setCookie.match(/session_id=([^;]+)/);
      if (match) this.sessionId = match[1];
    }

    const data: JsonRpcResponse = await response.json();

    if (data.error) {
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
        context: { lang: 'de_DE', tz: 'Europe/Berlin' },
        ...kwargs,
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
        context: { lang: 'de_DE', tz: 'Europe/Berlin' },
      },
    });
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
