import logging

import requests

_logger = logging.getLogger(__name__)

# Reuses the same shared secret + base URL as the recruitment bridge:
#   krawings.portal_base_url     -> e.g. http://127.0.0.1:3000
#   krawings.internal_api_token  -> must match KRAWINGS_INTERNAL_API_TOKEN in the portal
DEFAULT_PORTAL_BASE_URL = "http://127.0.0.1:3000"
PORTAL_TIMEOUT = 30


def _get_config(env):
    """Read the portal base URL + internal API token from system parameters."""
    icp = env["ir.config_parameter"].sudo()
    base_url = (icp.get_param("krawings.portal_base_url") or DEFAULT_PORTAL_BASE_URL).rstrip("/")
    token = icp.get_param("krawings.internal_api_token") or ""
    return base_url, token


def portal_post(env, path, payload):
    """POST to a portal internal endpoint with bearer authentication.

    Returns a ``(status_code, json_body)`` tuple. Transport errors propagate to
    the caller. A missing token raises ``ValueError`` so the caller can log a
    clear configuration message instead of a silent 401.
    """
    base_url, token = _get_config(env)
    if not token:
        raise ValueError(
            "Portal API token is not configured. Set the system parameter "
            "'krawings.internal_api_token' (and the matching "
            "KRAWINGS_INTERNAL_API_TOKEN in the portal)."
        )

    url = base_url + path
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer %s" % token,
        "X-Odoo-User-Id": str(env.uid),
    }

    _logger.info("[krawings_portal_invite] POST %s payload=%s", url, payload)
    response = requests.post(url, json=payload, headers=headers, timeout=PORTAL_TIMEOUT)

    try:
        body = response.json()
    except ValueError:
        body = {"error": (response.text or "")[:500]}
    return response.status_code, body
