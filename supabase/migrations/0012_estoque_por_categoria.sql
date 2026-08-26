-- 0012_estoque_por_categoria.sql
--
-- Duas correcoes no texto raiz da Julia (prompt_templates). Pela 0004, e aqui
-- que se muda o comportamento dela: tenant_agents.system_prompt e reescrito
-- pelo trigger a partir deste template.
--
-- 1. "Quais carros vc tem na loja?" -> "temos 13 carros disponiveis hoje"
--
-- Numero total nao ajuda ninguem a escolher, e a vitrine com treze veiculos
-- afoga o cliente logo no primeiro contato. O estoque ja devolve body_type em
-- cada carro (api_cars, desde a 0008), entao a Julia consegue abrir pelas
-- CATEGORIAS que existem naquele momento -- "temos SUV, hatch, sedan e picape"
-- -- e usar isso como primeiro filtro para entender o perfil do cliente antes
-- de mostrar carro nenhum. E o comeco da qualificacao, que e o papel da fase de
-- descoberta.
--
-- 2. Endereco e horario de outra loja escritos na unha no template
--
-- O texto raiz trazia "LOJA: Endereco Rua Av. Confuncio, 344, Batel. Horario de
-- atendimento: segunda a sabado, das 8h as 19h." Isso e de UMA loja, e o
-- template e o mesmo para a plataforma inteira: toda loja mandava esse endereco
-- e esse horario para os proprios clientes. O endereco e o horario de verdade
-- ja entram pelo bloco DADOS DA LOJA, montado por render_agent_prompt a partir
-- do que o lojista preenche na etapa 1 -- inclusive o horario de funcionamento
-- que a 0011 acabou de trazer. A linha fixa so podia contradizer.

-- 1. Fora o endereco fixo -------------------------------------------------
-- Aparece de duas formas: uma linha propria na descoberta e no encantamento, e
-- uma frase no meio do paragrafo de agendamento no fechamento.
update public.prompt_templates
   set template = regexp_replace(template, 'LOJA: Endereco[^' || chr(10) || ']*' || chr(10) || '+', '', 'g')
 where position('LOJA: Endereco' in template) > 0;

-- O `.*?` precisa ser preguicoso: um `[^.]*` para no ponto de "Av." e nao
-- alcanca o "Batel." do fim da frase.
update public.prompt_templates
   set template = regexp_replace(
     template,
     'loja funciona de segunda.*?Batel\.',
     'use o endereco e o horario de funcionamento que estao no bloco DADOS DA LOJA desta conversa. Nunca invente endereco nem horario: se nao estiverem preenchidos, confirme na base de conhecimento antes de responder.'
   )
 where position('Confuncio' in template) > 0;

-- 2. Abrir pelas categorias, nao pelo total --------------------------------
update public.prompt_templates
   set template = replace(
     template,
     'FOTOS DOS VEICULOS:',
     'PERGUNTA ABERTA SOBRE O ESTOQUE (quais carros voces tem, o que tem na loja, me mostra o que voces tem, tem carro disponivel): nao abra com o numero total de veiculos nem ofereca a vitrine inteira de cara. Dizer "temos 13 carros" nao ajuda o cliente a escolher nada. Consulte o estoque, olhe o campo body_type dos veiculos disponiveis e responda com as CATEGORIAS que a loja tem naquele momento, do jeito que o cliente fala (hatch, sedan, SUV, picape, utilitario, esportivo, van). Cite apenas as categorias que existem no estoque agora, nunca uma lista fixa e nunca uma categoria que a loja nao tem. Na mesma resposta faca UMA pergunta que ja comece a qualificar: qual desses tipos combina com o que ele procura, ou para que ele vai usar o carro. Tom: "Temos SUV, hatch, sedan e picape no patio agora. Qual desses combina mais com o que voce procura?"' || chr(10) ||
     'Se algum veiculo do estoque estiver sem categoria preenchida, ele continua existindo: nao esconda esse carro, inclua quando o cliente pedir para ver tudo ou quando ele se encaixar no perfil.' || chr(10) ||
     'Depois que o cliente escolher a categoria, monte a vitrine daquela categoria seguindo as regras de foto abaixo e siga aprofundando o perfil (uso principal, quem vai dirigir, orcamento, cambio, forma de pagamento, troca) uma pergunta de cada vez, sem virar questionario. Se o cliente insistir em ver tudo, ai sim mostre a vitrine completa.' || chr(10) || chr(10) ||
     'FOTOS DOS VEICULOS:'
   )
 where position('FOTOS DOS VEICULOS:' in template) > 0
   and position('PERGUNTA ABERTA SOBRE O ESTOQUE' in template) = 0;

-- Remonta os tres prompts de todas as lojas com o texto novo.
update public.tenant_agents set system_prompt = system_prompt;
