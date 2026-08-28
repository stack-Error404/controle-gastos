# Livro Caixa — V4.1.0

Aplicativo web/PWA de controle financeiro pessoal.

## Recursos
- proventos e despesas;
- saldo mensal;
- orçamento mensal;
- calendário;
- categorias personalizáveis;
- edição e exclusão de lançamentos;
- carimbo visual de status **PAGO** / **A PAGAR**;
- gestos de arrastar para o lado estilo Gmail (Swipe para Editar ou Excluir);
- seletor de paletas de cores e temas visuais (6 temas completos);
- pesquisa e filtros avançados (incluindo filtro por situação pago/pendente);
- comparativo mensal;
- gráficos e estatísticas;
- backup JSON completo;
- importação/restauração de backup;
- exportação CSV compatível com Excel;
- relatório mensal para impressão/salvamento em PDF;
- compartilhamento do link;
- funcionamento offline após o primeiro carregamento;
- cartões de crédito ilimitados, com fechamento, vencimento e limite opcional;
- lançamentos futuros em qualquer mês;
- lançamentos fixos com repetição mensal e cancelamento da recorrência;
- leitura OCR de comprovantes e notas fiscais com preenchimento automático;
- captura direta pela câmera ou envio de fotos/PDF da memória do aparelho (PNG, JPEG, PDF);
- compatibilidade com os dados das versões anteriores.

## Armazenamento
Os dados ficam no `localStorage` do navegador de cada usuário. O GitHub hospeda apenas os arquivos do aplicativo.

## GitHub Pages
Envie o conteúdo desta pasta para a raiz do repositório e mantenha o GitHub Pages publicado pela branch `main` em `/ (root)`.

## Atualização
O service worker usa o cache `livro-caixa-v4.1.0`. Ao publicar uma atualização futura, altere o nome do cache para garantir renovação dos arquivos.

## Novidades 4.1.0
- **Carimbo "PAGO" e "A PAGAR"**: identificação visual no estilo clássico com toque direto para alternar a liquidação de qualquer conta;
- **Filtro por Situação**: novo filtro no Livro de Lançamentos para listar apenas contas pagas ou pendentes a pagar;
- **Gestos de Swipe (estilo Gmail)**: arraste qualquer lançamento para a direita para **Editar** ou para a esquerda para **Apagar** rapidamente;
- **6 Paletas de Cores Personalizadas**:
  - *Clássico (Pergaminho)*: tema tradicional de livro caixa com papel antigo e detalhes em couro e verde;
  - *Clássico Noturno*: versão escura do livro clássico com dourado e tons escuros;
  - *Branco & Vermelho*: estilo minimalista com fundo branco, letras pretas e botões/ações em vermelho carmim;
  - *Preto & Carmim*: fundo escuro elegante com destaques e ações em vermelho;
  - *Branco & Rosé*: fundo claro com toques sofisticados de rosa e ações em preto;
  - *Preto & Magenta*: fundo escuro moderno com detalhes em rosa e destaques vibrantes;
- **Acesso Rápido às Paletas**: botão 🎨 no topo do aplicativo e nas configurações para troca instantânea de tema.
- **Leitura OCR e extração automática**: leitura de comprovantes de pagamento e notas fiscais com preenchimento inteligente de valor, data, descrição/beneficiário, categoria e forma de pagamento;
- **Envio da memória do aparelho**: novo botão para enviar comprovantes em imagem (PNG, JPG, JPEG, WEBP) ou documentos em PDF (faturas, Pix e boletos bancários) direto da galeria e arquivos;
- **Captura rápida via Câmera**: botão dedicado na tela inicial e no formulário para fotografar notas físicas e carimbar lançamentos;
- **Suporte nativo a PDF**: extração direta de texto via PDF.js e OCR com Tesseract.js v5;

## Novidades 3.3.1
- nomenclatura **Proventos**, incluindo proventos fixos mensais;
- formas de pagamento: dinheiro, Pix, débito, crédito e criptomoeda;
- controle de tamanho das letras salvo no aparelho;
- área de avisos fixada com instruções de instalação para iOS e Android;
- formas de pagamento incluídas em filtros visuais, relatório, CSV e backup;

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
