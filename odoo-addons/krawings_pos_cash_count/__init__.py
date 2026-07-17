from . import models


def _set_default_coin_flags(env):
    """Pre-tick 'Is a coin' for existing sub-note denominations on install.

    Anything with a value below the smallest euro note (< 5) is treated as a
    coin by default, so staff are not forced to tick all eight EUR coins by
    hand. This only touches records that are still unset, and can be freely
    overridden afterwards in POS > Configuration > Coins/Bills.
    """
    env["pos.bill"].search(
        [("value", ">", 0), ("value", "<", 5.0), ("is_coin", "=", False)]
    ).write({"is_coin": True})
