-- TUR 2: uploads are immutable once inserted. The mobile client uses upsert=false and
-- lifecycle cleanup is service-role only, so authenticated UPDATE is unnecessary and
-- creates an avoidable pre-consume overwrite/TOCTOU surface.
drop policy if exists tailmance_storage_update on storage.objects;
