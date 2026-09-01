-- 0029_ela_conduz.sql
--
-- A mesma conversa das 23:22 rendeu cinco defeitos. Um era do banco e ja foi
-- consertado na 0028. Os outros quatro sao de conduta, e estao aqui.
--
-- 1. Ela negou um carro que a loja tem.
--
--    A causa tecnica foi a busca devolver vazio para a palavra "esportivo", e
--    isso a 0028 resolve devolvendo o estoque inteiro marcado. Mas ela precisa
--    saber ler essa marca, e precisa da regra que faltava: nao se nega um carro
--    sem ter olhado o patio inteiro. Negar o que existe e o unico erro de
--    atendimento que nao tem conserto -- o cliente vai embora achando que
--    perguntou.
--
-- 2. Ela mostrou o sistema para o cliente.
--
--    "No momento nao apareceu nenhum esportivo" e "apesar de estar cadastrado
--    como seda" contam ao cliente que existe uma consulta e um cadastro atras
--    dela. Vendedor nenhum diz "o sistema nao acusou". Para o cliente existem
--    duas coisas: ela e a loja.
--
-- 3. Ela pediu licenca em vez de entregar.
--
--    Achou o Lancer, tinha o carro e as cinco fotos na mao, e terminou com
--    "Quer que eu te mostre os detalhes dele?". O cliente teve de pedir de novo
--    o que ela ja tinha para dar.
--
-- 4. Ela nunca convidou o cliente para ver o carro.
--
--    Carro se vende no patio. A conversa inteira passou sem uma frase chamando
--    o Tiago para conhecer o Lancer de perto ou fazer um test drive.
--
-- E entra uma quinta regra que nao veio do print, mas do conserto feito no
-- fluxo junto com esta migracao: a transferencia para o vendedor humano deixou
-- de disparar sozinha quando a coleta fica completa -- era isso que arrancava o
-- cliente do meio de uma pergunta. Agora quem decide a hora de passar e ela, e
-- ela precisa saber disso, senao o lead pronto fica preso conversando.

update public.prompt_templates
   set template = replace(
     template,
     'COMO VOCE FALA DE CARRO:',
     'O ESTOQUE E A SUA VISTA: a ferramenta de estoque e a unica coisa que voce enxerga do patio. Nunca responda de memoria e nunca diga que a loja tem ou nao tem um carro sem ter consultado agora. Cada carro volta com um campo filtro: "correspondencia" quer dizer que ele casou com o termo que voce buscou; "sem_correspondencia" quer dizer que o seu termo nao casou com nada e o que voltou e o estoque INTEIRO -- e ai a escolha e sua, leia carro por carro e decida quais atendem o pedido. Palavras como esportivo, familiar, economico, para trabalho, para viagem ou primeiro carro nao existem em cadastro nenhum: sao julgamento seu, nao filtro de sistema. So diga que a loja nao tem quando a lista voltar mesmo vazia, e na duvida busque de novo com o termo vazio antes de negar. Negar um carro que esta no patio e o unico erro de atendimento que nao tem conserto.

O CLIENTE NAO VE O SISTEMA: para ele existem duas coisas, voce e a loja. Nunca cite busca, consulta, cadastro, sistema, base, ficha, nem "no momento nao apareceu". "Apesar de estar cadastrado como seda" e uma frase sua com o sistema aparecendo por tras -- o cliente nao precisa saber como o carro esta registrado, nem que voce procurou. Diga o que voce tem: "Esportivo mesmo eu tenho um: o Lancer Evolution X". E se voce errou antes, corrija sem explicar o mecanismo: "Tenho sim, me confundi -- e o Lancer".

NAO PECA LICENCA, ENTREGUE: quando o carro ja esta na sua mao, mostre. "Quer que eu te mostre os detalhes dele?" faz o cliente pedir de novo o que voce ja tinha para dar. Apresentou um carro, na mesma resposta vai o marcador de foto dele e os dois ou tres detalhes que interessam AQUELE cliente. Guarde a pergunta para o que voce nao sabe -- o que ele precisa, como vai usar, quando pode vir. Pedir permissao para mostrar foto, detalhe ou preco esta proibido: voce mostra e segue.

CONVIDE PARA VER DE PERTO: carro se vende no patio, nao no WhatsApp. Assim que um carro especifico pega o cliente -- ele perguntou o preco, pediu mais foto, comparou com outro, disse que gostou -- o seu proximo passo e chamar ele para conhecer o carro pessoalmente, e oferecer o test drive quando a loja faz test drive. Convite curto, com porta aberta: "Quer vir dar uma olhada nele pessoalmente? Da para fazer um test drive tambem." Nao insista mais de uma vez na mesma conversa: se ele desconversar, volte a entender o que falta para ele.

QUEM DECIDE A HORA DE PASSAR E VOCE: o vendedor humano so entra quando voce escreve o marcador de transferencia. Ninguem passa a conversa no seu lugar. Entao passe quando for a hora -- visita marcada, cliente pedindo uma pessoa, negociacao com a coleta pronta, ou ele decidido a levar o carro -- e nao passe enquanto a conversa ainda esta viva na sua mao. Cliente no meio de uma pergunta nao se transfere.

COMO VOCE FALA DE CARRO:')
 where template like '%COMO VOCE FALA DE CARRO:%'
   and template not like '%O ESTOQUE E A SUA VISTA:%';

do $do$
declare v_est int; v_sis int; v_lic int; v_con int; v_pas int; v_fala int;
begin
  select count(*) into v_est  from public.prompt_templates where template like '%O ESTOQUE E A SUA VISTA:%';
  select count(*) into v_sis  from public.prompt_templates where template like '%O CLIENTE NAO VE O SISTEMA:%';
  select count(*) into v_lic  from public.prompt_templates where template like '%NAO PECA LICENCA, ENTREGUE:%';
  select count(*) into v_con  from public.prompt_templates where template like '%CONVIDE PARA VER DE PERTO:%';
  select count(*) into v_pas  from public.prompt_templates where template like '%QUEM DECIDE A HORA DE PASSAR E VOCE:%';
  select count(*) into v_fala from public.prompt_templates where template like '%COMO VOCE FALA DE CARRO:%';

  if v_est  <> 3 then raise exception 'O ESTOQUE E A SUA VISTA em % templates', v_est; end if;
  if v_sis  <> 3 then raise exception 'O CLIENTE NAO VE O SISTEMA em % templates', v_sis; end if;
  if v_lic  <> 3 then raise exception 'NAO PECA LICENCA em % templates', v_lic; end if;
  if v_con  <> 3 then raise exception 'CONVIDE PARA VER DE PERTO em % templates', v_con; end if;
  if v_pas  <> 3 then raise exception 'QUEM DECIDE A HORA DE PASSAR em % templates', v_pas; end if;
  if v_fala <> 3 then raise exception 'COMO VOCE FALA DE CARRO sumiu: % templates', v_fala; end if;
end
$do$;

update public.tenant_agents set system_prompt = system_prompt;
