# Mockup navegável do Portal do Cliente

Abra [mockup-portal.html](mockup-portal.html) em um navegador. O arquivo contém
CSS, JavaScript e logotipo; funciona sozinho, sem instalação ou conexão com o
Vela. Cliente, BLs, containers, navios, agentes, contatos e valores são fictícios.

O protótipo apresenta Painel, Faturas, detalhes de fatura, BLs e Containers,
detalhes de BL, Perfil e Central de Informações. A Central reúne Taxas Locais,
Onde devolver, Demurrage, Agentes, Atendimento e Tracking. Não há tarifas de
exportação ou Detention.

Use **Explorar cenários** na faixa superior para acessar as jornadas:

- AURU1234567: escolha entre os depots do porto de Vitória.
- AURU2345678: indicação específica do Terminal Enseada.
- AURU3456789: indicação específica em Salvador e prazo de free time excedido.

A tela de devolução possui uma área exclusiva de avaliação para simular
indicação de um ou vários depots, indicação indisponível e retirada da indicação.
Esse controle não fará parte da interface do cliente.

Filtros e navegação funcionam localmente. Pagamento, envio de mensagens,
agendamento, mapas e acesso ao tracking são demonstrativos. Não há chamadas
ao backend nem envio de dados. Alterações não persistem após recarregar.

Verificação: 24 telas em larguras de 1440 e 390 pixels, sem transbordamento
horizontal da página; filtros de containers, taxas e agentes; busca de unidade;
cenários de devolução; modais de contato e tracking; ausência de erros JavaScript.
As imagens nesta pasta são capturas do protótipo, não de produção.
