-- Contagem por tabela do schema atendimento, para a conferencia JSON x Supabase.
--
-- O schema atendimento fica fora da API REST, entao o script de conferencia nao
-- consegue rodar um count direto. Esta funcao devolve, numa chamada so, quantas
-- linhas cada tabela tem — o suficiente para bater com a contagem do JSON local.
-- So a chave de servico executa, como a funcao de escrita.
create or replace function public.contar_atendimento()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  t record;
  total bigint;
  saida jsonb := '{}'::jsonb;
begin
  for t in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'atendimento' and c.relkind = 'r'
    order by c.relname
  loop
    execute format('select count(*) from atendimento.%I', t.relname) into total;
    saida := saida || jsonb_build_object(t.relname, total);
  end loop;
  return saida;
end $$;

revoke all on function public.contar_atendimento() from public;
revoke all on function public.contar_atendimento() from anon;
revoke all on function public.contar_atendimento() from authenticated;
grant execute on function public.contar_atendimento() to service_role;

comment on function public.contar_atendimento() is
  'Contagem de linhas por tabela do schema atendimento. So service_role. Usada pela conferencia JSON x Supabase.';
