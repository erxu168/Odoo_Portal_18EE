export interface SupplierLogin {
  id: number;
  partner_id: [number, string];   // [id, name] from Odoo
  company_id: [number, string];   // [id, name] from Odoo
  username: string;
  password: string;
  website_url: string | false;
  notes: string | false;
}

export interface SupplierGroup {
  id: number;
  name: string;
  website: string | false;
  logins: SupplierLoginRow[];
}

export interface SupplierLoginRow {
  id: number;
  company_id: number;
  company_name: string;
  username: string;
  password: string;
  website_url: string | false;
  notes: string | false;
}

export interface CredentialFormData {
  partner_id: number;
  company_id: number;
  username: string;
  password: string;
  website_url?: string;
  notes?: string;
}
