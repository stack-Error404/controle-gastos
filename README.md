# Livro Caixa — V3.0.1

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
- compatibilidade com os dados das Etapas 2 e 3;
- migração dos gastos do formato antigo `expenses:AAAA-MM`.

## Armazenamento
Os dados ficam no `localStorage` do navegador de cada usuário. O GitHub hospeda apenas os arquivos do aplicativo.

## GitHub Pages
Envie o conteúdo desta pasta para a raiz do repositório e mantenha o GitHub Pages publicado pela branch `main` em `/ (root)`.

## Atualização
O service worker usa o cache `livro-caixa-v3-final-3.0.1`. Ao publicar uma atualização futura, altere o nome do cache para garantir renovação dos arquivos.
