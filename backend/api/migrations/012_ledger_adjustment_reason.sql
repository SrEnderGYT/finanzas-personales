-- CHECK treats NULL as satisfied: require an explicit reason even for direct SQL.
ALTER TABLE app.ledger_transactions ADD CONSTRAINT ledger_adjustment_reason_required
CHECK (kind<>'adjustment' OR (reason IS NOT NULL AND length(btrim(reason)) BETWEEN 1 AND 240));
