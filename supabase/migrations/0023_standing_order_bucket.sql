-- ============================================================
-- 0023_standing_order_bucket.sql
--
-- A Supabase Storage bucket for the Standing Order PDF.
--
-- WHY
-- The public Standing Order page used to paraphrase the SMUSA
-- Sponsorship Standing Order by hand. The order changes, and a
-- reworded copy invites confusion, so the page now shows the source
-- document itself in an in-page PDF reader. Admins replace it from
-- Settings; no deploy, no table, no column.
--
-- HOW THE FILE IS KEPT TO ONE
-- Each upload gets a fresh name (standing-order-<timestamp>.pdf), and
-- the uploader then removes every OLDER object in the bucket (see
-- AdminAPI.uploadStandingOrder). So the bucket holds exactly one PDF
-- at rest, and storage use never grows with the number of versions.
-- A fresh name per upload also means a browser or CDN can never serve
-- a cached copy of the previous version, so the files are cached
-- aggressively. Readers always take the NEWEST object, so if a
-- clean-up ever fails the page still shows the right file, and the
-- next upload sweeps the leftover away.
--
-- ACCESS
--   read (list + download)  anyone; the document is public policy
--   upload, delete          admins only, via public.is_admin()
-- No update policy: files are never overwritten in place.
--
-- LIMITS
-- The bucket only accepts application/pdf, up to 20 MB per file. The
-- Settings card checks both before uploading; the bucket enforces them
-- regardless of the UI.
--
-- SAFETY
-- Idempotent: the bucket insert upserts its settings, and every policy
-- is dropped before it is created. Safe to re-run.
-- ============================================================

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('standing-order', 'standing-order', true, 20971520, array['application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists standing_order_read   on storage.objects;
drop policy if exists standing_order_insert on storage.objects;
drop policy if exists standing_order_delete on storage.objects;

-- Listing the bucket needs a SELECT policy even though the bucket is
-- public: "public" only opens the download URL. The page lists the
-- bucket to find the current file and its upload date.
create policy standing_order_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'standing-order');

create policy standing_order_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'standing-order' and public.is_admin());

create policy standing_order_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'standing-order' and public.is_admin());

commit;

-- ------------------------------------------------------------
-- Verify (run separately):
--
--   select id, public, file_size_limit, allowed_mime_types
--     from storage.buckets where id = 'standing-order';
--     -- expect one row: true, 20971520, {application/pdf}
--
--   select policyname, cmd from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--      and policyname like 'standing_order_%';
--     -- expect standing_order_read (SELECT), standing_order_insert
--     -- (INSERT), standing_order_delete (DELETE)
-- ------------------------------------------------------------
