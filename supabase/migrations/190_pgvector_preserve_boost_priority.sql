-- Tailmance v19 R8: pgvector ranking must not erase the established Boost product contract.
-- Safety/privacy/discovery gates run first; active Boost priority remains primary; vector/rule
-- compatibility ranks only within the same Boost class.

create or replace function public.rerank_discovery_with_match_vectors(p_active_pet_id uuid,p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_query extensions.vector; v_result jsonb;
begin
  if not public.owns_pet(p_active_pet_id) then raise exception 'forbidden'; end if;
  v_query:=public.compute_pet_match_embedding(p_active_pet_id,true);
  with items as (
    select x.item,x.ord,(x.item->>'id')::uuid as pet_id,
      coalesce((x.item->>'boosted')::boolean,false) as boosted,
      greatest(0,least(100,coalesce((x.item->>'compatibilityScore')::numeric,0))) as base_score
    from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) with ordinality x(item,ord)
  ), scored as (
    select i.*,
      case when e.embedding is null then null
           else greatest(0::numeric,least(1::numeric,(1-(e.embedding <=> v_query))::numeric)) end as vector_similarity
    from items i left join public.pet_match_embeddings e on e.pet_id=i.pet_id
  ), blended as (
    select s.*,
      case when s.vector_similarity is null then round(s.base_score)::int
           else round((s.base_score*0.70)+(s.vector_similarity*100*0.30))::int end as hybrid_score
    from scored s
  )
  select coalesce(jsonb_agg(
    (b.item||jsonb_build_object(
      'compatibilityScore',greatest(0,least(100,b.hybrid_score)),
      'compatibilityModel',case when b.vector_similarity is null then 'rules-v1' else 'rules-pgvector-v1' end
    ))
    order by b.boosted desc,b.hybrid_score desc,b.ord
  ),'[]'::jsonb) into v_result from blended b;
  return v_result;
end $$;
revoke all on function public.rerank_discovery_with_match_vectors(uuid,jsonb) from public,anon,authenticated;
