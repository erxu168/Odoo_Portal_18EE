export interface PrepCompany {
  id: number;
  name: string;
}

export const COMPANIES: PrepCompany[] = [
  { id: 3, name: 'Ssam Kottbusser' },
  // 6, not 5: staging merged the old WAJ company (5) into 6 — the till posts
  // under 6, and 5 no longer resolves to an active company at all.
  { id: 6, name: 'What a Jerk' },
];

// WAJ is the restaurant with a LIVE till on staging; Ssam's staging sales
// stopped in March, so defaulting to 3 showed an empty screen.
export const DEFAULT_COMPANY_ID = 6;
