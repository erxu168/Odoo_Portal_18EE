# Tablet PIN-only login — design

## Goal
A shared kitchen tablet's LOGIN screen shows a PIN pad instead of email/password.
Staff enter only a 4-digit PIN to access the Kitchen Station home. Email/password
is used exactly once, by a manager, to set the tablet up.

## Trust model (approved): one-time manager provisioning
A manager, on the tablet, authenticates with THEIR OWN login and picks the restaurant.
The device is issued a long-lived httpOnly device token (`kw_tablet`) bound to that
restaurant's shared "station" account. Thereafter the tablet's login is PIN-only.
Only a provisioned device can show/use the PIN login (prevents remote PIN-guessing).

## Pieces
1. **db.ts** — `station_devices` table (token_hash sha256, station_user_id FK, company_id,
   label, created_by, created_at, last_used_at, revoked). Helpers: provision / lookup
   (by token, not revoked, touch last_used_at) / revoke / findStationAccountForCompany.
2. **POST /api/tablet/provision** {email,password,company_id} — manager+rate-limited;
   find station account for company; issue token; set httpOnly `kw_tablet` (long-lived).
   No session created.
3. **GET /api/tablet/status** — {provisioned, company_id?, company_name?} from the cookie.
4. **POST /api/tablet/pin-login** {pin} — device cookie → station account + company;
   rate-limited; findUserByPinInCompany; on match create a session AS the station account
   (createSession) + kw_session cookie + mint acting token (createStationActor) + kw_actor
   cookie + kw_company_id cookie. Returns the acting user.
5. **POST /api/tablet/deprovision** {email,password} — manager auth → revoke + clear cookie.
6. **/login page** — device-aware: provisioned → PIN pad; else email/password + "Set up
   shared tablet" (opens provisioning form: manager creds + restaurant picker). PIN pad
   success → useShift().signIn(person) + navigate to '/'.

## Reuse / integration
- Kitchen Station home, StationGate ("Signed in as X"/Done/idle), and the hardened
  server-minted acting-token attribution are unchanged.
- Hybrid session model (lower risk): the station session persists; after Done, StationGate's
  existing PIN lock sets the next actor within the session. The /login PIN pad only runs
  when there is NO session (fresh/expired) — it creates one. Both look identical to users,
  and email/password never shows on a provisioned tablet.

## Security
- PIN login refused without a valid (non-revoked) device token → no remote guessing.
- Session created is the is_shared_device station account → kitchen-only scope; a PIN never
  reaches HR/pay/admin. Rate-limited. Manager-revocable.

## Out of scope
- Production rollout (staging only). Per-action cross-company attribution (already deferred).
