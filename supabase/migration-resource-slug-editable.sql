-- Existing Supabase projects: run once in the SQL Editor.
-- Allows authorized administrators to change resource slugs.
-- Public links and QR codes will then use the new slug; old printed QR codes
-- and old links will no longer resolve to that resource.
drop trigger if exists resources_slug_immutable_trg on public.resources;
drop function if exists public.prevent_resource_slug_change();
