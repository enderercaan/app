-- Tailmance v19 R8: add call notification enum in an isolated transaction.
-- PostgreSQL requires newly-added enum values to be committed before downstream use.

alter type public.notification_type add value if not exists 'call';
