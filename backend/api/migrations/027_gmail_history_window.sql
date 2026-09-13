-- Keep enough history to build month-by-month finance views.
-- Subscription recurrence is still evaluated over a shorter 90-day business window.
UPDATE app.gmail_connections
SET range_days = 365,
    updated_at = now()
WHERE range_days < 365;
