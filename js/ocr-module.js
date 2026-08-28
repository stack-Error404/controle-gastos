// js/ocr-module.js
// Leitura OCR e extração de dados de comprovantes e notas fiscais (PNG, JPEG, PDF).
// Utiliza Tesseract.js v5 para OCR de imagens e PDF.js para leitura de documentos PDF.

(() => {
  'use strict';

  // Configura worker do PDF.js caso esteja carregado na página
  if (typeof globalThis.pdfjsLib !== 'undefined') {
    globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const moneyRegex = /(?:R\$\s*)?(?:\d{1,3}(?:[.\s]\d{3})+|\d+)[,.]\d{2}\b/g;

  const toast = (message) => {
    if (typeof globalThis.showToast === 'function') {
      globalThis.showToast(message);
    } else {
      console.info(message);
    }
  };

  const normalize = (value = '') =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  const todayISO = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const loadImage = (fileOrBlob) =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(fileOrBlob);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Não foi possível abrir a imagem do comprovante.'));
      };
      image.src = url;
    });

  const preprocessImage = async (fileOrBlob) => {
    const image = await loadImage(fileOrBlob);
    const longestSide = Math.max(image.naturalWidth, image.naturalHeight);

    let scale = 1;
    if (longestSide > 2200) scale = 2200 / longestSide;
    else if (longestSide < 1400) scale = Math.min(2, 1400 / longestSide);

    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, width, height);

    // Escala de cinza e realce de contraste para recibos com sombra ou fundo amarelado
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const contrast = 1.35;

    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const adjusted = Math.max(0, Math.min(255, (gray - 128) * contrast + 128));
      data[i] = adjusted;
      data[i + 1] = adjusted;
      data[i + 2] = adjusted;
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  };

  const parseMoney = (raw) => {
    if (!raw) return null;

    let value = raw
      .replace(/R\$/gi, '')
      .replace(/\s/g, '')
      .replace(/[^\d,.-]/g, '')
      .replace(/-/g, '');

    const lastComma = value.lastIndexOf(',');
    const lastDot = value.lastIndexOf('.');

    if (lastComma >= 0 && lastDot >= 0) {
      if (lastComma > lastDot) value = value.replace(/\./g, '').replace(',', '.');
      else value = value.replace(/,/g, '');
    } else if (lastComma >= 0) {
      value = value.replace(/\./g, '').replace(',', '.');
    } else if (lastDot >= 0) {
      const decimals = value.length - lastDot - 1;
      if (decimals !== 2) value = value.replace(/\./g, '');
    }

    const number = Number.parseFloat(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  };

  const extractValue = (lines) => {
    const positivePatterns = [
      [/total\s+a\s+pagar/i, 130],
      [/valor\s+a\s+pagar/i, 125],
      [/valor\s+total/i, 120],
      [/total\s+geral/i, 115],
      [/total\s+da\s+compra/i, 115],
      [/valor\s+pago/i, 110],
      [/valor\s+do\s+pix|valor\s+pix|valor\s+transferido|valor\s+recebido|valor\s+enviado/i, 110],
      [/valor\s+l[ií]quido/i, 105],
      [/valor\s+cobrado|valor\s+do\s+documento/i, 100],
      [/total\s+r\$/i, 100],
      [/total\b/i, 90],
      [/a\s+pagar/i, 85],
      [/valor\b/i, 65],
      [/pago\b/i, 60]
    ];
    const negativePattern = /subtotal|desconto|troco|economia|acrescimo|acréscimo|taxa|unit[aá]rio|qtd|quantidade|itens|peso/i;
    const ignorePattern = /cnpj|cpf|cep|telefone|fone|coo|cupom|documento|chave|nfc|sat|autentica|protocolo|terminal|ag[eê]ncia|conta/i;
    const candidates = [];

    lines.forEach((line, index) => {
      const matches = line.match(moneyRegex) || [];
      if (!matches.length || ignorePattern.test(line)) return;

      let lineScore = 0;
      for (const [pattern, score] of positivePatterns) {
        if (pattern.test(line)) {
          lineScore = Math.max(lineScore, score);
          break;
        }
      }
      if (negativePattern.test(line)) lineScore -= 80;

      // Totais costumam aparecer perto do final do comprovante
      lineScore += Math.round((index / Math.max(lines.length, 1)) * 15);

      matches.forEach((raw, matchIndex) => {
        const value = parseMoney(raw);
        if (value === null) return;
        candidates.push({
          value,
          score: lineScore + matchIndex,
          index
        });
      });
    });

    if (!candidates.length) return 0;

    const prioritized = candidates.filter((candidate) => candidate.score >= 50);
    const pool = prioritized.length ? prioritized : candidates;

    pool.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.index !== a.index) return b.index - a.index;
      return b.value - a.value;
    });

    return pool[0].value;
  };

  const MONTH_NAMES = {
    jan: 1, janeiro: 1,
    fev: 2, fevereiro: 2,
    mar: 3, marco: 3, março: 3,
    abr: 4, abril: 4,
    mai: 5, maio: 5,
    jun: 6, junho: 6,
    jul: 7, julho: 7,
    ago: 8, agosto: 8,
    set: 9, setembro: 9,
    out: 10, outubro: 10,
    nov: 11, novembro: 11,
    dez: 12, dezembro: 12
  };

  const extractDate = (text) => {
    // 1. Formato numérico: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
    const numericMatch = text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b|\b(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})\b/);
    if (numericMatch) {
      let year;
      let month;
      let day;

      if (numericMatch[4]) {
        year = Number(numericMatch[4]);
        month = Number(numericMatch[5]);
        day = Number(numericMatch[6]);
      } else {
        day = Number(numericMatch[1]);
        month = Number(numericMatch[2]);
        year = Number(numericMatch[3]);
        if (year < 100) year += 2000;
      }

      const date = new Date(year, month - 1, day);
      if (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day &&
        year >= 2000 &&
        year <= 2100
      ) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }

    // 2. Formato textual brasileiro: "28 de agosto de 2026", "15 fev 2026"
    const textDateMatch = text.match(/\b(\d{1,2})\s*(?:de\s*)?([A-Za-zçÇ]{3,9})\s*(?:de\s*)?(\d{4})\b/i);
    if (textDateMatch) {
      const day = Number(textDateMatch[1]);
      const monthKey = normalize(textDateMatch[2]).slice(0, 3);
      const month = MONTH_NAMES[monthKey] || MONTH_NAMES[normalize(textDateMatch[2])];
      const year = Number(textDateMatch[3]);

      if (month && day >= 1 && day <= 31 && year >= 2000 && year <= 2100) {
        const date = new Date(year, month - 1, day);
        if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
          return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
      }
    }

    return todayISO();
  };

  const extractMerchant = (lines) => {
    // 1. Procura prefixos de comprovantes Pix e transferências bancárias
    const recipientPrefixRegex = /^(?:destinat[aá]rio|recebedor|favorecido|benefici[aá]rio|nome\s+do\s+recebedor|para|empresa|estabelecimento)\s*[:\-]\s*(.*)$/i;
    for (const line of lines) {
      const match = line.match(recipientPrefixRegex);
      if (match && match[1]) {
        const clean = match[1].replace(/[^\p{L}\p{N}&.'()\-\s]/gu, ' ').replace(/\s+/g, ' ').trim();
        if (clean.length >= 3 && clean.length <= 80 && /[A-Za-zÀ-ÿ]/.test(clean)) {
          return clean.slice(0, 80);
        }
      }
    }

    // 2. Procura cabeçalho da nota / razão social nas primeiras linhas
    const ignore = /comprovante|cnpj|cpf|cupom|nota fiscal|documento|danfe|nfc-e|sat|consumidor|cliente|telefone|fone|cep|endere[cç]o|data|hora|total|subtotal|valor|pagamento|pix|cr[eé]dito|d[eé]bito|dinheiro|chave|autentica/i;

    for (const line of lines.slice(0, 12)) {
      const candidate = line
        .replace(/[^\p{L}\p{N}&.'()\-\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (candidate.length < 3 || candidate.length > 80) continue;
      if (ignore.test(candidate)) continue;
      if (!/[A-Za-zÀ-ÿ]/.test(candidate)) continue;
      if (/^\d[\d\s./-]+$/.test(candidate)) continue;
      return candidate.slice(0, 80);
    }

    return 'Compra por comprovante';
  };

  const availableCategories = () => {
    const select = document.getElementById('entryCategory');
    if (!select) return [];
    return [...select.options]
      .map((option) => ({ value: option.value, label: option.textContent.trim() }))
      .filter((option) => option.value);
  };

  const chooseCategory = (text) => {
    const options = availableCategories();
    if (!options.length) return null;

    const normalizedText = normalize(text);

    // Se o próprio nome de uma categoria cadastrada estiver no comprovante, priorize
    const direct = options.find((option) => {
      const label = normalize(option.label);
      return label.length >= 4 && normalizedText.includes(label);
    });
    if (direct) return direct.value;

    const rules = [
      {
        words: /mercado|supermercado|atacad|restaurante|lanchonete|padaria|acougue|açougue|alimento|ifood|rappi|hortifruti|frutaria|panificadora|refeic|pizzaria|burger|hamburguer|bar\b|cafe\b|café/,
        aliases: ['alimentacao', 'alimentação', 'mercado', 'comida', 'refeicao', 'refeição']
      },
      {
        words: /posto|combust|gasolina|etanol|diesel|uber|99app|99\s*pop|estacionamento|pedagio|pedágio|transporte|metro|metrô|onibus|ônibus|passagem|sem\s*parar|veloe|auto\s*posto/,
        aliases: ['transporte', 'combustivel', 'combustível', 'veiculo', 'carro']
      },
      {
        words: /farmacia|farmácia|drogaria|hospital|clinica|clínica|laboratorio|laboratório|medic|remedio|remédio|consulta|dentista|odont|exame|drogasil|droga\s*raia|pague\s*menos|ultrafarma/,
        aliases: ['saude', 'saúde', 'farmacia', 'farmácia', 'medico', 'médico']
      },
      {
        words: /aluguel|condominio|condomínio|energia|eletric|enel|cemig|copel|cpfl|light|sabesp|sanepar|copasa|caesb|agua|água|internet|claro|vivo|tim|oi|moradia|casa|residencia|residência|iptu|gas|gás/,
        aliases: ['moradia', 'casa', 'residencia', 'residência', 'contas', 'fixas']
      },
      {
        words: /curso|escola|colegio|colégio|faculdade|universidade|mensalidade|livraria|papelaria|udemy|alura|educacao|educação/,
        aliases: ['educacao', 'educação', 'estudos', 'cursos']
      },
      {
        words: /cinema|streaming|netflix|spotify|disney|prime\s*video|hbo|max|show|lazer|teatro|parque|ingresso|jogo|games/,
        aliases: ['lazer', 'entretenimento', 'diversao', 'diversão']
      },
      {
        words: /petshop|pet\s*shop|veterin|ração|racao|petz|cobasi|animais/,
        aliases: ['pet', 'animais', 'cachorro', 'gato']
      },
      {
        words: /hotel|pousada|passagem\s*aerea|aérea|companhia\s*aerea|latam|gol|azul|airbnb|booking|decolar|viagem|turismo/,
        aliases: ['viagem', 'turismo', 'ferias', 'férias']
      },
      {
        words: /fatura|cartao\s*de\s*credito|cartão\s*de\s*crédito|nubank|itaucard|bradescard|santander|c6\s*bank|inter/,
        aliases: ['cartao', 'cartão', 'fatura', 'credito', 'crédito']
      }
    ];

    for (const rule of rules) {
      if (!rule.words.test(normalizedText)) continue;
      const match = options.find((option) => {
        const label = normalize(option.label);
        return rule.aliases.some((alias) => label.includes(normalize(alias)));
      });
      if (match) return match.value;
    }

    const other = options.find((option) => /outros?|diversos?/i.test(option.label));
    return other ? other.value : null;
  };

  const detectPayment = (text) => {
    const normalizedText = normalize(text);
    if (/\bpix\b|chave\s*pix|transferencia\s*pix|transferência\s*pix/.test(normalizedText)) return 'pix';
    if (/credito|crédito|credit\s*card|mastercard|visa\s*credit|fatura|parcela/.test(normalizedText)) return 'credit';
    if (/debito|débito|debit\s*card|visa\s*electron|maestro/.test(normalizedText)) return 'debit';
    if (/dinheiro|especie|espécie|cash/.test(normalizedText)) return 'cash';
    return null;
  };

  const setFieldValue = (id, value, { onlyIfEmpty = false } = {}) => {
    const field = document.getElementById(id);
    if (!field || value === null || value === undefined || value === '') return;
    if (onlyIfEmpty && String(field.value || '').trim()) return;

    field.value = String(value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const ensureEntryModalOpen = () => {
    if (typeof globalThis.openEntryModal === 'function') {
      const modal = document.getElementById('entryModal');
      if (!modal || modal.hidden) {
        globalThis.openEntryModal();
      }
    }
  };

  const parseAndFillReceiptData = (text, lines) => {
    if (!text && (!lines || !lines.length)) {
      throw new Error('Não foi possível extrair o texto do comprovante.');
    }

    const cleanLines = (lines || text.split(/\r?\n/))
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const cleanedText = cleanLines.join('\n');

    const value = extractValue(cleanLines);
    const date = extractDate(cleanedText);
    const merchant = extractMerchant(cleanLines);
    const category = chooseCategory(cleanedText);
    const payment = detectPayment(cleanedText);

    ensureEntryModalOpen();

    if (value > 0) setFieldValue('entryValue', value.toFixed(2));
    setFieldValue('entryDate', date);
    setFieldValue('entryDescription', merchant, { onlyIfEmpty: true });
    if (category) setFieldValue('entryCategory', category);
    if (payment) setFieldValue('entryPayment', payment);
    setFieldValue(
      'entryNote',
      'Dados preenchidos por leitura de comprovante/nota. Confira antes de salvar.',
      { onlyIfEmpty: true }
    );

    if (value > 0) {
      toast('Comprovante lido com sucesso! Confira os dados antes de salvar.');
    } else {
      toast('Texto reconhecido. Confira os campos antes de carimbar o lançamento.');
    }
  };

  const processPDF = async (file) => {
    toast('Lendo arquivo PDF...');
    if (typeof globalThis.pdfjsLib === 'undefined') {
      throw new Error('Biblioteca PDF indisponível. Conecte-se à internet.');
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await globalThis.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const maxPages = Math.min(pdf.numPages, 3);

    let extractedLines = [];

    // 1. Extrai texto vetorial do PDF (comprovantes digitais de bancos, e-mails, boletos)
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      if (textContent && textContent.items && textContent.items.length > 0) {
        // Ordena itens por posição vertical (Y) e horizontal (X)
        const items = textContent.items.slice();
        items.sort((a, b) => {
          const yA = a.transform ? a.transform[5] : 0;
          const yB = b.transform ? b.transform[5] : 0;
          if (Math.abs(yB - yA) > 4) return yB - yA;
          const xA = a.transform ? a.transform[4] : 0;
          const xB = b.transform ? b.transform[4] : 0;
          return xA - xB;
        });

        let currentY = null;
        let currentLine = '';

        for (const item of items) {
          const itemY = item.transform ? item.transform[5] : 0;
          if (currentY === null || Math.abs(currentY - itemY) > 4) {
            if (currentLine.trim()) extractedLines.push(currentLine.trim());
            currentY = itemY;
            currentLine = item.str || '';
          } else {
            currentLine += ' ' + (item.str || '');
          }
        }
        if (currentLine.trim()) extractedLines.push(currentLine.trim());
      }
    }

    const combinedText = extractedLines.join('\n').trim();

    // Se o PDF possuir texto digital direto
    if (combinedText.length >= 30) {
      parseAndFillReceiptData(combinedText, extractedLines);
      return;
    }

    // 2. Se for um PDF digitalizado/escaneado (imagem embutida), renderiza em alta resolução e executa OCR
    toast('PDF escaneado: executando OCR...');
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    await page.render({ canvasContext: ctx, viewport }).promise;

    await runTesseractOCR(canvas);
  };

  const runTesseractOCR = async (imageOrCanvas) => {
    if (!globalThis.Tesseract) {
      throw new Error('OCR indisponível. Recarregue o app conectado à internet.');
    }

    let worker = null;
    try {
      worker = await globalThis.Tesseract.createWorker('por', 1, {
        logger: (message) => {
          if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
            const percent = Math.round(message.progress * 100);
            if (percent === 25 || percent === 50 || percent === 75 || percent === 100) {
              toast(`Lendo comprovante... ${percent}%`);
            }
          }
        }
      });

      const { data: { text = '' } = {} } = await worker.recognize(imageOrCanvas);
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

      if (!lines.length) throw new Error('Nenhum texto identificado na imagem do comprovante.');

      parseAndFillReceiptData(lines.join('\n'), lines);
    } finally {
      if (worker) {
        try {
          await worker.terminate();
        } catch (err) {
          console.warn('Erro ao encerrar worker:', err);
        }
      }
    }
  };

  const processReceiptFile = async (file) => {
    if (!file) return;

    try {
      const isPdf =
        file.type === 'application/pdf' ||
        (file.name && file.name.toLowerCase().endsWith('.pdf'));

      if (isPdf) {
        await processPDF(file);
      } else {
        toast('Preparando imagem...');
        const canvas = await preprocessImage(file);
        await runTesseractOCR(canvas);
      }
    } catch (error) {
      console.error('Erro ao processar comprovante:', error);
      toast(error?.message || 'Erro ao processar arquivo.');
    }
  };

  // Abre diretamente a câmera do aparelho para tirar foto do comprovante
  const openCameraScanner = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.hidden = true;

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (file) await processReceiptFile(file);
      input.remove();
    }, { once: true });

    document.body.appendChild(input);
    input.click();
  };

  // Abre o seletor de arquivos / galeria de fotos (PNG, JPEG, PDF)
  const openFileUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/jpg,image/webp,application/pdf,.pdf,.png,.jpg,.jpeg';
    input.hidden = true;

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (file) await processReceiptFile(file);
      input.remove();
    }, { once: true });

    document.body.appendChild(input);
    input.click();
  };

  const setupEventListeners = () => {
    document.querySelectorAll('[data-ocr-camera]').forEach((btn) => {
      if (!btn.dataset.ocrBound) {
        btn.dataset.ocrBound = 'true';
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          openCameraScanner();
        });
      }
    });

    document.querySelectorAll('[data-ocr-upload]').forEach((btn) => {
      if (!btn.dataset.ocrBound) {
        btn.dataset.ocrBound = 'true';
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          openFileUpload();
        });
      }
    });

    const homeCameraBtn = document.getElementById('homeCameraBtn');
    if (homeCameraBtn && !homeCameraBtn.dataset.ocrBound) {
      homeCameraBtn.dataset.ocrBound = 'true';
      homeCameraBtn.addEventListener('click', openCameraScanner);
    }

    const homeUploadBtn = document.getElementById('homeUploadBtn');
    if (homeUploadBtn && !homeUploadBtn.dataset.ocrBound) {
      homeUploadBtn.dataset.ocrBound = 'true';
      homeUploadBtn.addEventListener('click', openFileUpload);
    }

    const modalCameraBtn = document.getElementById('modalCameraBtn');
    if (modalCameraBtn && !modalCameraBtn.dataset.ocrBound) {
      modalCameraBtn.dataset.ocrBound = 'true';
      modalCameraBtn.addEventListener('click', openCameraScanner);
    }

    const modalUploadBtn = document.getElementById('modalUploadBtn');
    if (modalUploadBtn && !modalUploadBtn.dataset.ocrBound) {
      modalUploadBtn.dataset.ocrBound = 'true';
      modalUploadBtn.addEventListener('click', openFileUpload);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupEventListeners);
  } else {
    setupEventListeners();
  }

  // Exporta no escopo global
  globalThis.OCR = {
    openCameraScanner,
    openFileUpload,
    processReceiptFile
  };
})();
