# Livro Caixa — V3.1.0

Aplicativo web/PWA de controle financeiro pessoal.

## Recursos
- receitas e despesas;
- saldo mensal;
- orçamento mensal;
- calendário;
- categorias personalizáveis;
- edição e exclusão de lançamentos;
- pesquisa e filtros;
- comparativo mensal;
- gráficos e estatísticas;
- backup JSON completo;
- importação/restauração de backup;
- exportação CSV compatível com Excel;
- relatório mensal para impressão/salvamento em PDF;
- compartilhamento do link;
- funcionamento offline após o primeiro carregamento;
- modo escuro;
- cartões de crédito ilimitados, com fechamento, vencimento e limite opcional;
- lançamentos futuros em qualquer mês;
- lançamentos fixos com repetição mensal e cancelamento da recorrência;
- compatibilidade com os dados das Etapas 2 e 3;
- migração dos gastos do formato antigo `expenses:AAAA-MM`.

## Armazenamento
Os dados ficam no `localStorage` do navegador de cada usuário. O GitHub hospeda apenas os arquivos do aplicativo.

## GitHub Pages
Envie o conteúdo desta pasta para a raiz do repositório e mantenha o GitHub Pages publicado pela branch `main` em `/ (root)`.

## Atualização
O service worker usa o cache `livro-caixa-v3-final-3.1.0`. Ao publicar uma atualização futura, altere o nome do cache para garantir renovação dos arquivos.

## Novidades 3.1.0
- nova área **Planejar**;
- cadastro, edição e exclusão de quantos cartões forem necessários;
- associação opcional de lançamentos a um cartão;
- agenda de lançamentos futuros;
- criação e cancelamento de lançamentos fixos mensais;
- backup e CSV atualizados para incluir os novos dados;


## Correção 3.0.2
- compartilhamento usa o endereço oficial do GitHub Pages;
- link é incluído também no texto compartilhado;
- fallback copia o endereço quando o compartilhamento nativo não estiver disponível.

## Correção 3.0.3
- corrigido registro dos eventos dos botões de Backup, Importação, CSV, PDF, Compartilhamento e Atualização;
- corrigido status do PWA que permanecia em "Verificando…";
- mantido o compartilhamento pelo endereço oficial do GitHub Pages.
