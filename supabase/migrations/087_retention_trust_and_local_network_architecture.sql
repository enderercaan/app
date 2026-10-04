-- Tailmance v19 R8: add lost-pet notification enum in its own migration transaction.
-- PostgreSQL requires newly added enum values to commit before later migrations use them.

alter type public.notification_type add value if not exists 'lost_pet';
