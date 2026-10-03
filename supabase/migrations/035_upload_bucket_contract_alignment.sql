-- Tailmance TUR 2: keep Supabase Storage bucket contracts aligned with the
-- upload-intent allowlist and the mobile preflight size limits.
-- Buckets remain private; this only removes false client/server rejections.

update storage.buckets
set public=false,
    file_size_limit=10485760,
    allowed_mime_types=array['image/jpeg','image/png','image/webp','image/heic','image/heif']
where id='pet-photos';

update storage.buckets
set public=false,
    file_size_limit=15728640,
    allowed_mime_types=array['image/jpeg','image/png','image/webp','image/heic','image/heif']
where id='social-media';

update storage.buckets
set public=false,
    file_size_limit=15728640,
    allowed_mime_types=array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif']
where id='health-documents';

update storage.buckets
set public=false,
    file_size_limit=10485760,
    allowed_mime_types=array['image/jpeg','image/png','image/webp','image/heic','image/heif']
where id='pet-verification';
