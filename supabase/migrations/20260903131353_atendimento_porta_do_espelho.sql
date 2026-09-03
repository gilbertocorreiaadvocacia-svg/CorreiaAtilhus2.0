-- A unica porta de escrita do Correiatendimentos para o Supabase.
--
-- O schema `atendimento` fica FORA da API REST de proposito. Expo-lo abriria as
-- 25 tabelas de uma vez; aqui abre-se uma funcao so, que faz exatamente duas
-- coisas (gravar e apagar por id) e nada mais.
--
-- O lote chega como vetor, e nao um pedido por registro: o sistema ja junta as
-- alteracoes numa rajada curta antes de gravar em disco, e o espelho segue o
-- mesmo ritmo. Uma triagem de 40 conversas vira uma chamada, nao quarenta.
--
-- A lista de tabelas permitidas sai do catalogo, e nao de um vetor escrito
-- aqui: nome de tabela vindo de fora entra em format(%I), e uma lista fixa
-- ficaria velha no dia em que uma tabela nova fosse criada.
create or replace function public.espelhar_atendimento(lote jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  item      jsonb;
  gravados  int := 0;
  apagados  int := 0;
  permitidas text[];
begin
  if jsonb_typeof(lote) is distinct from 'array' then
    raise exception 'o lote precisa ser um vetor';
  end if;

  select array_agg(c.relname)
    into permitidas
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'atendimento' and c.relkind = 'r';

  for item in select * from jsonb_array_elements(lote) loop
    if not (item->>'t' = any (permitidas)) then
      raise exception 'tabela desconhecida: %', coalesce(item->>'t', '(nula)');
    end if;
    if coalesce(item->>'id', '') = '' then
      raise exception 'registro sem id em %', item->>'t';
    end if;

    if item->>'op' = 'del' then
      execute format('delete from atendimento.%I where id = $1', item->>'t')
        using item->>'id';
      apagados := apagados + 1;
    else
      if jsonb_typeof(item->'d') is distinct from 'object' then
        raise exception 'registro sem corpo em %/%', item->>'t', item->>'id';
      end if;
      execute format($f$insert into atendimento.%I (id, dados) values ($1, $2)
                        on conflict (id) do update set dados = excluded.dados$f$, item->>'t')
        using item->>'id', item->'d';
      gravados := gravados + 1;
    end if;
  end loop;

  return jsonb_build_object('gravados', gravados, 'apagados', apagados);
end $$;

-- So a chave de servico executa. A chave publicavel vai no navegador de
-- qualquer aplicacao Supabase: se ela pudesse chamar isto, qualquer um
-- escreveria na base do escritorio.
revoke all on function public.espelhar_atendimento(jsonb) from public;
revoke all on function public.espelhar_atendimento(jsonb) from anon;
revoke all on function public.espelhar_atendimento(jsonb) from authenticated;
grant execute on function public.espelhar_atendimento(jsonb) to service_role;

comment on function public.espelhar_atendimento(jsonb) is
  'Escrita em lote no schema atendimento (Correiatendimentos). Cada item: {t: tabela, id: texto, d: objeto} ou {t, id, op: "del"}. So service_role executa.';
