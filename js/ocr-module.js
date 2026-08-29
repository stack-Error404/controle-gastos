// js/ocr-module.js
// Leitura OCR e extração inteligente de dados de comprovantes e notas fiscais (PNG, JPEG, PDF).
// Utiliza Tesseract.js v5 com pré-processamento avançado e PDF.js para leitura vetorial e escaneada.

(() => {
  'use strict';

  // Configura worker do PDF.js caso esteja carregado na página
  if (typeof globalThis.pdfjsLib !== 'undefined') {
    globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const toast = (message) => {
    if (typeof globalThis.showToast === 'function') {
      globalThis.showToast(message);
    } else {
      console.info(message);
    }
  };

  const normalize = (value = '') =>
    String(value)
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

  // Filtro de nitidez (Sharpening Convolution Kernel) para recibos térmicos e textos pequenos
  const applySharpening = (ctx, width, height) => {
    try {
      const imgData = ctx.getImageData(0, 0, width, height);
      const data = imgData.data;
      const copy = new Uint8ClampedArray(data);

      // Kernel Laplacian suave para realçar bordas de caracteres matriciais e térmicos
      const weights = [
        0, -0.4, 0,
        -0.4, 2.6, -0.4,
        0, -0.4, 0
      ];

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const dstIdx = (y * width + x) * 4;
          let r = 0, g = 0, b = 0;

          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const srcIdx = ((y + ky) * width + (x + kx)) * 4;
              const weight = weights[(ky + 1) * 3 + (kx + 1)];
              r += copy[srcIdx] * weight;
              g += copy[srcIdx + 1] * weight;
              b += copy[srcIdx + 2] * weight;
            }
          }

          data[dstIdx] = Math.max(0, Math.min(255, r));
          data[dstIdx + 1] = Math.max(0, Math.min(255, g));
          data[dstIdx + 2] = Math.max(0, Math.min(255, b));
        }
      }

      ctx.putImageData(imgData, 0, 0);
    } catch (e) {
      console.warn('Sharpening filter error:', e);
    }
  };

  // Pré-processamento avançado de imagem (Auto-Levels, Escala Inteligente e Contraste Adaptativo)
  const preprocessImage = async (fileOrBlob) => {
    const image = await loadImage(fileOrBlob);
    const longestSide = Math.max(image.naturalWidth, image.naturalHeight);

    // Resolução ideal do Tesseract para recibos é ~1800-2200px no maior lado
    let scale = 1;
    if (longestSide > 2400) {
      scale = 2400 / longestSide;
    } else if (longestSide < 1800) {
      scale = Math.min(6, 1800 / longestSide);
    }

    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // 1. Converte para Escala de Cinza e calcula histograma para Auto-Levels
    const histogram = new Uint32Array(256);
    const totalPixels = width * height;

    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
      histogram[gray]++;
    }

    // Identifica percentis 2% e 98% para esticar a faixa de contraste e eliminar fundo cinza/amarelado
    let acc = 0;
    let minGray = 0;
    let maxGray = 255;
    const lowerCut = totalPixels * 0.02;
    const upperCut = totalPixels * 0.98;

    for (let g = 0; g < 256; g++) {
      acc += histogram[g];
      if (acc >= lowerCut && minGray === 0) minGray = g;
      if (acc >= upperCut) {
        maxGray = g;
        break;
      }
    }

    if (maxGray <= minGray) {
      minGray = 0;
      maxGray = 255;
    }

    const range = maxGray - minGray || 1;

    // 2. Aplica estiramento de contraste (Auto-levels) e realce de texto escuro
    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i];
      let stretched = ((gray - minGray) / range) * 255;
      stretched = Math.max(0, Math.min(255, stretched));

      // Curva gama para aumentar contraste entre texto preto e fundo branco
      let finalVal = stretched;
      if (stretched > 165) {
        finalVal = Math.min(255, stretched * 1.15 + 15); // Clareia fundo
      } else if (stretched < 110) {
        finalVal = Math.max(0, stretched * 0.75); // Escurece texto
      }

      data[i] = finalVal;
      data[i + 1] = finalVal;
      data[i + 2] = finalVal;
    }

    ctx.putImageData(imageData, 0, 0);

    // 3. Aplica nitidez nas bordas
    applySharpening(ctx, width, height);

    return canvas;
  };

  const parseMoney = (raw) => {
    if (!raw) return null;

    let value = String(raw)
      .replace(/R\$/gi, '')
      .replace(/[oO]/g, '0') // Correção de OCR de 'O' para '0'
      .replace(/\s+/g, '')
      .replace(/[^\d,.-]/g, '')
      .replace(/^-+|-+$/g, '');

    const lastComma = value.lastIndexOf(',');
    const lastDot = value.lastIndexOf('.');

    if (lastComma >= 0 && lastDot >= 0) {
      if (lastComma > lastDot) value = value.replace(/\./g, '').replace(',', '.');
      else value = value.replace(/,/g, '');
    } else if (lastComma >= 0) {
      value = value.replace(/\./g, '').replace(',', '.');
    } else if (lastDot >= 0) {
      const decimals = value.length - lastDot - 1;
      if (decimals !== 2 && decimals !== 1) value = value.replace(/\./g, '');
    }

    const number = Number.parseFloat(value);
    return Number.isFinite(number) && number > 0 && number < 10000000 ? number : null;
  };

  const extractValue = (lines) => {
    const positivePatterns = [
      [/total\s+a\s+pagar|valor\s+a\s+pagar|total\s+geral|total\s+liquido|total\s+l[ií]quido|total\s+da\s+nota|total\s+da\s+compra/i, 160],
      [/valor\s+total/i, 150],
      [/valor\s+do\s+pix|valor\s+pago|valor\s+recebido|valor\s+enviado|valor\s+transferido|valor\s+cobrado/i, 140],
      [/total\s*r?\$|total\s*:\s*r?\$|total\s*=\s*r?\$|total\s*:\s*/i, 130],
      [/\btotal\b/i, 115],
      [/dinheiro|pix|cart[aã]o\s*de\s*cr[eé]dito|cart[aã]o\s*de\s*d[eé]bito|d[eé]bito|cr[eé]dito/i, 100],
      [/a\s+pagar/i, 90],
      [/valor\b/i, 70],
      [/pago\b/i, 65]
    ];

    const negativePattern = /subtotal|desconto|troco|economia|acrescimo|acréscimo|tarifa|taxa|unit[aá]rio|qtd|quantidade|itens|peso/i;
    const ignorePattern = /cnpj|cpf|cep|telefone|fone|coo|ccf|ecf|ie:|im:|vers[aã]o|chave|autentica|protocolo|terminal|ag[eê]ncia|conta\b|fab:|daruma/i;

    const moneyRegex = /(?:R\$\s*)?(?:\d{1,3}(?:[.\s]\d{3})+|\d+)[,.]\d{2}\b|(?:R\$\s*)(\d+[,.]\d{1,2})\b/gi;

    const candidates = [];

    lines.forEach((line, index) => {
      // Ignora alíquotas percentuais (ex: 17,00%) para não confundir com valor
      const cleanLine = line.replace(/\d+[,.]\d{2}\s*%/g, ' ');

      const isIgnoreLine = ignorePattern.test(cleanLine) && !/total|pago|dinheiro|pix/i.test(cleanLine);
      if (isIgnoreLine) return;

      const matches = cleanLine.match(moneyRegex) || [];
      if (!matches.length) {
        // Se a linha tiver a palavra TOTAL mas o valor estiver na linha imediatamente seguinte
        if (/total|valor\s+total|a\s+pagar/i.test(cleanLine) && lines[index + 1]) {
          const nextMatches = lines[index + 1].match(moneyRegex) || [];
          nextMatches.forEach((raw, mIdx) => {
            const value = parseMoney(raw);
            if (value !== null) {
              candidates.push({
                value,
                score: 130 + mIdx,
                index: index + 1,
                line: lines[index + 1]
              });
            }
          });
        }
        return;
      }

      let lineScore = 0;
      for (const [pattern, score] of positivePatterns) {
        if (pattern.test(cleanLine)) {
          lineScore = Math.max(lineScore, score);
          break;
        }
      }

      if (negativePattern.test(cleanLine)) lineScore -= 80;

      // Linhas finais do comprovante costumam conter os totais
      lineScore += Math.round((index / Math.max(lines.length, 1)) * 20);

      matches.forEach((raw, matchIndex) => {
        const value = parseMoney(raw);
        if (value === null) return;

        candidates.push({
          value,
          score: lineScore + matchIndex,
          index,
          line: cleanLine
        });
      });
    });

    if (!candidates.length) return 0;

    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.index !== a.index) return b.index - a.index;
      return b.value - a.value;
    });

    return candidates[0].value;
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
    // 1. Formatos numéricos: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY-MM-DD
    const matches = text.matchAll(/\b(?:(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})|(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2}))\b/g);
    for (const match of matches) {
      let year, month, day;
      if (match[4]) {
        year = Number(match[4]);
        month = Number(match[5]);
        day = Number(match[6]);
      } else {
        day = Number(match[1]);
        month = Number(match[2]);
        year = Number(match[3]);
        if (year < 100) year += 2000;
      }

      if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2000 && year <= 2040) {
        const date = new Date(year, month - 1, day);
        if (
          date.getFullYear() === year &&
          date.getMonth() === month - 1 &&
          date.getDate() === day
        ) {
          return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
      }
    }

    // 2. Formato textual brasileiro: "28 de agosto de 2026", "11 out 2014"
    const textDateMatch = text.match(/\b(\d{1,2})\s*(?:de\s*)?([A-Za-zçÇ]{3,9})\s*(?:de\s*)?(\d{4})\b/i);
    if (textDateMatch) {
      const day = Number(textDateMatch[1]);
      const monthKey = normalize(textDateMatch[2]).slice(0, 3);
      const month = MONTH_NAMES[monthKey] || MONTH_NAMES[normalize(textDateMatch[2])];
      const year = Number(textDateMatch[3]);

      if (month && day >= 1 && day <= 31 && year >= 2000 && year <= 2040) {
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
    const recipientPrefixRegex = /^(?:destinat[aá]rio|recebedor|favorecido|benefici[aá]rio|nome\s+do\s+recebedor|nome|para|empresa|estabelecimento)\s*[:\-]\s*(.*)$/i;
    for (const line of lines) {
      const match = line.match(recipientPrefixRegex);
      if (match && match[1]) {
        const clean = match[1].replace(/[^\p{L}\p{N}&.'()\-\s]/gu, ' ').replace(/\s+/g, ' ').trim();
        if (clean.length >= 3 && clean.length <= 80 && /[A-Za-zÀ-ÿ]/.test(clean)) {
          if (!/consumidor|cpf|cnpj|nao\s+informado/i.test(clean)) {
            return clean.slice(0, 80);
          }
        }
      }
    }

    // 2. Procura descrição de itens ou produtos na nota (ex: Coca-Cola)
    for (const line of lines) {
      const itemMatch = line.match(/(?:item|\d{3})\s+\d*\s*([A-Za-zÀ-ÿ0-9\s\-]+?)(?:\s+\d+und|\s+t\d+|\s+\d+[,.]\d{2})/i);
      if (itemMatch && itemMatch[1]) {
        const itemDesc = itemMatch[1].trim();
        if (itemDesc.length >= 3 && !/codigo|descricao|qtd|unit/i.test(itemDesc)) {
          return itemDesc.slice(0, 80);
        }
      }
    }

    // 3. Procura cabeçalho da nota / razão social nas primeiras linhas
    const ignore = /razao\s*social|razão\s*social|meu\s*endereco|minha\s*cidade|meu\s*telefone|comprovante|cnpj|cpf|cupom|nota fiscal|documento|danfe|nfc-e|sat|consumidor|cliente|telefone|fone|cep|endere[cç]o|data|hora|total|subtotal|valor|pagamento|pix|cr[eé]dito|d[eé]bito|dinheiro|chave|autentica|framework/i;

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

    // Se houver algum nome nas linhas seguintes
    for (const line of lines) {
      if (/daruma|coca[- ]cola|posto|mercado|farmacia|padaria/i.test(line)) {
        const found = line.replace(/[^\p{L}\p{N}&.'()\-\s]/gu, ' ').replace(/\s+/g, ' ').trim();
        if (found.length >= 3) return found.slice(0, 80);
      }
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
        words: /coca[- ]cola|refrigerante|bebida|suco|cerveja|lanche|comida|alimento|almoco|almoço|jantar|refeic|pao|pão|leite|carne|frango|queijo|mercado|supermercado|atacad|restaurante|lanchonete|padaria|acougue|açougue|ifood|rappi|hortifruti|frutaria|panificadora|pizzaria|burger|hamburguer|bar\b|cafe\b|café|sorvete|doce|chocolate/,
        aliases: ['alimentacao', 'alimentação', 'mercado', 'comida', 'refeicao', 'refeição', 'restaurante']
      },
      {
        words: /posto|combust|gasolina|etanol|diesel|gnv|uber|99app|99\s*pop|estacionamento|pedagio|pedágio|transporte|metro|metrô|onibus|ônibus|passagem|sem\s*parar|veloe|auto\s*posto|ipiranga|shell|petrobras|br\s*distribuidora/,
        aliases: ['transporte', 'combustivel', 'combustível', 'veiculo', 'carro']
      },
      {
        words: /farmacia|farmácia|drogaria|hospital|clinica|clínica|laboratorio|laboratório|medic|remedio|remédio|consulta|dentista|odont|exame|drogasil|droga\s*raia|pague\s*menos|ultrafarma|panvel|sao\s*joao/,
        aliases: ['saude', 'saúde', 'farmacia', 'farmácia', 'medico', 'médico']
      },
      {
        words: /aluguel|condominio|condomínio|energia|eletric|enel|cemig|copel|cpfl|light|sabesp|sanepar|copasa|caesb|agua|água|internet|claro|vivo|tim|oi|moradia|casa|residencia|residência|iptu|gas|gás/,
        aliases: ['moradia', 'casa', 'residencia', 'residência', 'contas', 'fixas']
      },
      {
        words: /curso|escola|colegio|colégio|faculdade|universidade|mensalidade|livraria|papelaria|udemy|alura|educacao|educação|livro|caderno|apostila/,
        aliases: ['educacao', 'educação', 'estudos', 'cursos']
      },
      {
        words: /cinema|streaming|netflix|spotify|disney|prime\s*video|hbo|max|show|lazer|teatro|parque|ingresso|jogo|games|steam|playstation|xbox/,
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
        words: /fatura|cartao\s*de\s*credito|cartão\s*de\s*crédito|nubank|itaucard|bradescard|santander|c6\s*bank|inter|mercado\s*livre|amazon|shopee|magalu/,
        aliases: ['cartao', 'cartão', 'fatura', 'credito', 'crédito', 'compras']
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
    if (/\bpix\b|chave\s*pix|transferencia\s*pix|transferência\s*pix|comprovante\s*pix/.test(normalizedText)) return 'pix';
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
    setFieldValue('entryDescription', merchant);
    if (category) setFieldValue('entryCategory', category);
    if (payment) setFieldValue('entryPayment', payment);
    setFieldValue(
      'entryNote',
      'Dados preenchidos por leitura de comprovante/nota. Confira antes de salvar.',
      { onlyIfEmpty: true }
    );

    if (value > 0) {
      toast(`Comprovante lido! R$ ${value.toFixed(2).replace('.', ',')} identificado.`);
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

    if (combinedText.length >= 30) {
      parseAndFillReceiptData(combinedText, extractedLines);
      return;
    }

    // 2. Se for um PDF escaneado (imagem embutida), renderiza em alta resolução e executa OCR
    toast('PDF escaneado: executando OCR...');
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.5 });
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
      worker = await globalThis.Tesseract.createWorker(['por', 'eng'], 1, {
        logger: (message) => {
          if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
            const percent = Math.round(message.progress * 100);
            if (percent === 25 || percent === 50 || percent === 75 || percent === 100) {
              toast(`Lendo comprovante... ${percent}%`);
            }
          }
        }
      });

      await worker.setParameters({
        tessedit_pageseg_mode: '6'
      });

      let res = await worker.recognize(imageOrCanvas);
      let text = (res && res.data && res.data.text) || '';

      if (text.trim().length < 20) {
        await worker.setParameters({ tessedit_pageseg_mode: '3' });
        res = await worker.recognize(imageOrCanvas);
        text = (res && res.data && res.data.text) || text;
      }

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
        toast('Otimizando imagem do comprovante...');
        const canvas = await preprocessImage(file);
        await runTesseractOCR(canvas);
      }
    } catch (error) {
      console.error('Erro ao processar comprovante:', error);
      toast(error?.message || 'Erro ao processar arquivo.');
    }
  };

  let pendingOcrAction = null;

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

  // Modal explicativo com dicas de qualidade para leitura perfeita
  const openOcrTipsModal = (action = 'camera') => {
    pendingOcrAction = action;
    const modal = document.getElementById('ocrTipsModal');
    if (!modal) {
      if (action === 'camera') openCameraScanner();
      else openFileUpload();
      return;
    }

    const icon = document.getElementById('proceedOcrIcon');
    const label = document.getElementById('proceedOcrLabel');
    const title = document.getElementById('ocrTipsTitle');

    if (action === 'camera') {
      if (icon) icon.textContent = '📷';
      if (label) label.textContent = 'Abrir Câmera';
      if (title) title.textContent = 'Dicas para tirar a foto';
    } else {
      if (icon) icon.textContent = '📁';
      if (label) label.textContent = 'Selecionar Arquivo';
      if (title) title.textContent = 'Dicas para envio de arquivo';
    }

    modal.hidden = false;
    document.body.classList.add('modal-open');
  };

  const closeOcrTipsModal = () => {
    const modal = document.getElementById('ocrTipsModal');
    if (modal) modal.hidden = true;
    document.body.classList.remove('modal-open');
    pendingOcrAction = null;
  };

  const proceedWithOcr = () => {
    const action = pendingOcrAction;
    closeOcrTipsModal();
    if (action === 'camera') {
      openCameraScanner();
    } else {
      openFileUpload();
    }
  };

  const setupEventListeners = () => {
    document.querySelectorAll('[data-ocr-camera]').forEach((btn) => {
      if (!btn.dataset.ocrBound) {
        btn.dataset.ocrBound = 'true';
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          openOcrTipsModal('camera');
        });
      }
    });

    document.querySelectorAll('[data-ocr-upload]').forEach((btn) => {
      if (!btn.dataset.ocrBound) {
        btn.dataset.ocrBound = 'true';
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          openOcrTipsModal('upload');
        });
      }
    });

    const homeCameraBtn = document.getElementById('homeCameraBtn');
    if (homeCameraBtn && !homeCameraBtn.dataset.ocrBound) {
      homeCameraBtn.dataset.ocrBound = 'true';
      homeCameraBtn.addEventListener('click', () => openOcrTipsModal('camera'));
    }

    const homeUploadBtn = document.getElementById('homeUploadBtn');
    if (homeUploadBtn && !homeUploadBtn.dataset.ocrBound) {
      homeUploadBtn.dataset.ocrBound = 'true';
      homeUploadBtn.addEventListener('click', () => openOcrTipsModal('upload'));
    }

    const modalCameraBtn = document.getElementById('modalCameraBtn');
    if (modalCameraBtn && !modalCameraBtn.dataset.ocrBound) {
      modalCameraBtn.dataset.ocrBound = 'true';
      modalCameraBtn.addEventListener('click', () => openOcrTipsModal('camera'));
    }

    const modalUploadBtn = document.getElementById('modalUploadBtn');
    if (modalUploadBtn && !modalUploadBtn.dataset.ocrBound) {
      modalUploadBtn.dataset.ocrBound = 'true';
      modalUploadBtn.addEventListener('click', () => openOcrTipsModal('upload'));
    }

    const closeBtn = document.getElementById('closeOcrTipsBtn');
    if (closeBtn && !closeBtn.dataset.ocrBound) {
      closeBtn.dataset.ocrBound = 'true';
      closeBtn.addEventListener('click', closeOcrTipsModal);
    }

    const cancelBtn = document.getElementById('cancelOcrTipsBtn');
    if (cancelBtn && !cancelBtn.dataset.ocrBound) {
      cancelBtn.dataset.ocrBound = 'true';
      cancelBtn.addEventListener('click', closeOcrTipsModal);
    }

    const proceedBtn = document.getElementById('proceedOcrTipsBtn');
    if (proceedBtn && !proceedBtn.dataset.ocrBound) {
      proceedBtn.dataset.ocrBound = 'true';
      proceedBtn.addEventListener('click', proceedWithOcr);
    }

    const ocrTipsModal = document.getElementById('ocrTipsModal');
    if (ocrTipsModal && !ocrTipsModal.dataset.ocrBound) {
      ocrTipsModal.dataset.ocrBound = 'true';
      ocrTipsModal.addEventListener('click', (e) => {
        if (e.target === ocrTipsModal) closeOcrTipsModal();
      });
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
    openOcrTipsModal,
    closeOcrTipsModal,
    processReceiptFile
  };
})();
