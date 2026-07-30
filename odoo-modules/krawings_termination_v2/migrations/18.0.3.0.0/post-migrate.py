"""v3 migration: introduce the in_transit state + normalize attachment aliasing.

- signed records WITH dispatch evidence (method + sent date)  -> in_transit
- delivered records WITHOUT confirmed receipt                 -> in_transit (review list)
- records where the generated-PDF slot aliases the signed PDF -> clear the
  generated slot (the original unsigned PDF was deleted at signing time, so the
  one attachment must live in the signed slot only — otherwise a future
  "delete generated PDF" would remove the only copy).

Plain SQL on purpose: bypasses the new transition guard and creates no chatter
noise. Everything is logged for review.
"""
import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    # 1. signed + dispatch evidence -> in_transit
    cr.execute("""
        UPDATE kw_termination SET state = 'in_transit'
        WHERE state = 'signed' AND delivery_method IS NOT NULL AND delivery_date IS NOT NULL
        RETURNING id
    """)
    moved_signed = [r[0] for r in cr.fetchall()]

    # 2. delivered without confirmed receipt -> in_transit (needs human review)
    cr.execute("""
        UPDATE kw_termination SET state = 'in_transit'
        WHERE state = 'delivered' AND (delivery_confirmed IS NOT TRUE)
        RETURNING id
    """)
    review = [r[0] for r in cr.fetchall()]

    # 3. de-alias generated/signed PDF slots
    cr.execute("""
        UPDATE kw_termination SET pdf_attachment_id = NULL
        WHERE pdf_attachment_id IS NOT NULL
          AND pdf_attachment_id = signed_pdf_attachment_id
        RETURNING id
    """)
    dealiased = [r[0] for r in cr.fetchall()]

    _logger.info(
        'kw.termination v3 migration: signed->in_transit %s; '
        'delivered-without-confirmation->in_transit (REVIEW THESE) %s; '
        'de-aliased pdf slots %s',
        moved_signed, review, dealiased,
    )
