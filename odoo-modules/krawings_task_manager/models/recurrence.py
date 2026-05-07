"""Pure-function recurrence engine for krawings_task_manager.

Each task template line carries a recurrence rule. To spawn a daily list we ask
"does this rule fire on date D?" — that question is answered exclusively by
applies_on() in this module. Keeping the logic here (rather than scattered
across model methods) makes the rule both easy to test in isolation and easy
for the portal to mirror via a single Odoo call.

Field shape on krawings.task.template.line (see task_template_line.py):
  recurrence_type           Selection: once / daily / weekly / monthly / yearly
  recurrence_interval       Integer ≥ 1 — every N units
  recurrence_start_date     Date — first day the rule is effective
  recurrence_end_type       Selection: never / on_date / after_count
  recurrence_end_date       Date | False
  recurrence_count          Integer | False — total occurrences when end_type=after_count

  recurrence_one_off_date   Date — only set when type=once
  recurrence_weekdays       Char "0,1,..,6"  — Mon=0..Sun=6 (weekly only)
  recurrence_monthly_mode   Selection: day_of_month / weekday_of_month  (monthly + yearly)
  recurrence_day_of_month   Integer 1..31 or -1 for "last day"          (monthly_mode=day_of_month)
  recurrence_weekday_pos    Integer 1/2/3/4/-1 (first..fourth, last)    (monthly_mode=weekday_of_month)
  recurrence_weekday        Integer 0..6                                (monthly_mode=weekday_of_month)
  recurrence_month          Integer 1..12                               (yearly only)

Plus an exception_ids One2many → krawings.task.template.line.exception.date
"""

from datetime import date as date_cls, timedelta


def parse_weekdays(raw):
    """'0,1,4' → {0, 1, 4}; empty → empty set."""
    if not raw:
        return set()
    out = set()
    for part in str(raw).split(','):
        p = part.strip()
        if p == '':
            continue
        try:
            out.add(int(p))
        except ValueError:
            continue
    return out


def _last_day_of_month(year, month):
    if month == 12:
        nxt = date_cls(year + 1, 1, 1)
    else:
        nxt = date_cls(year, month + 1, 1)
    return (nxt - timedelta(days=1)).day


def _matches_day_of_month(target, day_of_month):
    """day_of_month: 1..31 or -1 for 'last day'."""
    if day_of_month == -1:
        return target.day == _last_day_of_month(target.year, target.month)
    return target.day == day_of_month


def _matches_nth_weekday(target, weekday, position):
    """position: 1/2/3/4 (first..fourth from start) or -1 (last)."""
    if target.weekday() != weekday:
        return False
    if position == -1:
        # Is this the last occurrence of `weekday` in this month?
        seven_later = target + timedelta(days=7)
        return seven_later.month != target.month
    # 1st = days 1-7, 2nd = 8-14, 3rd = 15-21, 4th = 22-28
    if position not in (1, 2, 3, 4):
        return False
    lower = (position - 1) * 7 + 1
    upper = position * 7
    return lower <= target.day <= upper


def _months_between(start, target):
    return (target.year - start.year) * 12 + (target.month - start.month)


def _weeks_between(start, target):
    """Calendar-week difference based on Monday anchor."""
    start_monday = start - timedelta(days=start.weekday())
    target_monday = target - timedelta(days=target.weekday())
    return (target_monday - start_monday).days // 7


def _occurrence_index(rule, target):
    """1-based index of which occurrence `target` is, within the rule.

    Used to enforce end_type=after_count. If `target` does not match the rule
    at all, returns 0 — caller should already have checked the type-specific
    match before calling this.
    """
    rtype = rule['type']
    interval = max(1, int(rule.get('interval') or 1))
    start = rule['start_date']

    if rtype == 'once':
        return 1
    if rtype == 'daily':
        days = (target - start).days
        return days // interval + 1
    if rtype == 'weekly':
        weeks = _weeks_between(start, target)
        # Within each block of `interval` weeks, count weekday hits in
        # order. We materialise the schedule day-by-day from start to target
        # to remain correct for arbitrary weekday selections.
        weekdays = rule.get('weekdays') or set()
        if not weekdays:
            return 0
        idx = 0
        cursor = start
        while cursor <= target:
            wk = _weeks_between(start, cursor)
            if wk % interval == 0 and cursor.weekday() in weekdays:
                idx += 1
                if cursor == target:
                    return idx
            cursor = cursor + timedelta(days=1)
        return 0
    if rtype == 'monthly':
        months = _months_between(start, target)
        return months // interval + 1
    if rtype == 'yearly':
        years = target.year - start.year
        return years // interval + 1
    return 0


def applies_on(rule, target):
    """True if the recurrence rule fires on the given date.

    `rule` is a dict with the keys named in the module docstring (without the
    `recurrence_` prefix). `target` is a datetime.date. `exceptions` is a set
    or iterable of datetime.date objects to skip.
    """
    if target < rule['start_date']:
        return False

    exceptions = rule.get('exceptions') or set()
    if not isinstance(exceptions, (set, frozenset)):
        exceptions = set(exceptions)
    if target in exceptions:
        return False

    end_type = rule.get('end_type') or 'never'
    if end_type == 'on_date':
        end_date = rule.get('end_date')
        if end_date and target > end_date:
            return False

    rtype = rule['type']
    interval = max(1, int(rule.get('interval') or 1))

    if rtype == 'once':
        if target != rule.get('one_off_date'):
            return False
    elif rtype == 'daily':
        if (target - rule['start_date']).days % interval != 0:
            return False
    elif rtype == 'weekly':
        weekdays = rule.get('weekdays') or set()
        if not weekdays or target.weekday() not in weekdays:
            return False
        if _weeks_between(rule['start_date'], target) % interval != 0:
            return False
    elif rtype == 'monthly':
        if _months_between(rule['start_date'], target) % interval != 0:
            return False
        if rule.get('monthly_mode') == 'weekday_of_month':
            if not _matches_nth_weekday(target, rule.get('weekday'), rule.get('weekday_pos')):
                return False
        else:
            if not _matches_day_of_month(target, rule.get('day_of_month')):
                return False
    elif rtype == 'yearly':
        years = target.year - rule['start_date'].year
        if years < 0 or years % interval != 0:
            return False
        wanted_month = rule.get('month')
        if wanted_month and target.month != wanted_month:
            return False
        if rule.get('monthly_mode') == 'weekday_of_month':
            if not _matches_nth_weekday(target, rule.get('weekday'), rule.get('weekday_pos')):
                return False
        else:
            if not _matches_day_of_month(target, rule.get('day_of_month')):
                return False
    else:
        return False

    if end_type == 'after_count':
        count = rule.get('count') or 0
        idx = _occurrence_index(rule, target)
        if idx == 0 or idx > count:
            return False

    return True


def rule_from_record(rec):
    """Translate an Odoo recordset (a single .line) into the dict applies_on consumes.

    Records are duck-typed by attribute access so this also works in tests with
    plain objects that mimic the field set.
    """
    monthly_mode = getattr(rec, 'recurrence_monthly_mode', None) or 'day_of_month'
    excs = set()
    try:
        for e in rec.exception_ids:
            if e.date:
                excs.add(e.date)
    except Exception:
        pass
    return {
        'type': rec.recurrence_type or 'daily',
        'interval': rec.recurrence_interval or 1,
        'start_date': rec.recurrence_start_date,
        'end_type': rec.recurrence_end_type or 'never',
        'end_date': rec.recurrence_end_date or None,
        'count': rec.recurrence_count or 0,
        'one_off_date': rec.recurrence_one_off_date or None,
        'weekdays': parse_weekdays(rec.recurrence_weekdays),
        'monthly_mode': monthly_mode,
        'day_of_month': rec.recurrence_day_of_month or 0,
        'weekday_pos': rec.recurrence_weekday_pos or 0,
        'weekday': rec.recurrence_weekday if rec.recurrence_weekday is not False else 0,
        'month': rec.recurrence_month or 0,
        'exceptions': excs,
    }
