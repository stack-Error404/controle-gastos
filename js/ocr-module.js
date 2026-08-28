// js/ocr-module.js
// Leitura OCR de comprovantes/notas usando Tesseract.js v5.

(() => {
  'use strict';

  const moneyRegex = /(?:R\$\s*)?(?:\d{1,3}(?:[.\s]\d{3})+|\d+)[,.]\d{2}\b/g;

  const toast = (message) => {
    if (typeof globalThis.showToast === 'function') globalThis.showToast(message);
    else console.info(message);
  };

  const normalize = (value = '') => value
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

  const loadImage = (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível abrir a imagem.'));
    };
    image.src = url;
  });

  const preprocessImage = async (file) => {
    const image = await loadImage(file);
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

    // Escala de cinza + contraste moderado. Isso ajuda principalmente em recibos
    // fotografados com sombra, papel amarelado ou texto pouco contrastado.
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
      [/total\s+a\s+pagar/i, 120],
      [/valor\s+a\s+pagar/i, 115],
      [/valor\s+total/i, 110],
      [/total\s+geral/i, 105],
      [/total\s+da\s+compra/i, 105],
      [/valor\s+pago/i, 100],
      [/total/i, 90],
      [/a\s+pagar/i, 85],
      [/pago/i, 70]
    ];
    const negativePattern = /subtotal|desconto|troco|economia|acrescimo|acréscimo|taxa|unit[aá]rio|qtd|quantidade/i;
    const ignorePattern = /cnpj|cpf|cep|telefone|fone|coo|cupom|documento|chave|nfc|sat/i;
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

      // Totais costumam aparecer perto do fim do comprovante.
      lineScore += Math.round((index / Math.max(lines.length, 1)) * 10);

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

    const prioritized = candidates.filter((candidate) => candidate.score >= 60);
    const pool = prioritized.length ? prioritized : candidates;

    pool.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.index !== a.index) return b.index - a.index;
      return b.value - a.value;
    });

    return pool[0].value;
  };

  const extractDate = (text) => {
    const match = text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b|\b(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})\b/);
    if (!match) return todayISO();

    let year;
    let month;
    let day;

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

    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) return todayISO();

    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const extractMerchant = (lines) => {
    const ignore = /cnpj|cpf|cupom|nota fiscal|documento|consumidor|cliente|telefone|fone|cep|endere[cç]o|data|hora|total|subtotal|valor|pagamento|pix|cr[eé]dito|d[eé]bito|dinheiro|nfc|sat|chave/i;

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

    // Se o próprio nome de uma categoria cadastrada estiver no comprovante, priorize-a.
    const direct = options.find((option) => {
      const label = normalize(option.label);
      return label.length >= 4 && normalizedText.includes(label);
    });
    if (direct) return direct.value;

    const rules = [
      { words: /mercado|supermercado|atacad|restaurante|lanchonete|padaria|acougue|açougue|alimento|ifood/, aliases: ['alimentacao', 'alimentação', 'mercado', 'comida'] },
      { words: /posto|combust|gasolina|etanol|diesel|uber|estacionamento|pedagio|pedágio|transporte/, aliases: ['transporte', 'combustivel', 'combustível'] },
      { words: /farmacia|farmácia|drogaria|hospital|clinica|clínica|laboratorio|laboratório|medic/, aliases: ['saude', 'saúde', 'farmacia', 'farmácia'] },
      { words: /aluguel|condominio|condomínio|energia|eletric|agua|água|internet|moradia/, aliases: ['moradia', 'casa', 'residencia', 'residência'] },
      { words: /hotel|pousada|passagem|companhia aerea|aérea|viagem/, aliases: ['viagem', 'turismo'] },
      { words: /petshop|pet shop|veterin|ração|racao/, aliases: ['pet', 'animais'] },
      { words: /cinema|streaming|netflix|spotify|show|lazer/, aliases: ['lazer', 'entretenimento'] }
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
    if (/\bpix\b/.test(normalizedText)) return 'pix';
    if (/credito|crédito|credit card/.test(normalizedText)) return 'credit';
    if (/debito|débito|debit card/.test(normalizedText)) return 'debit';
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

  const processReceipt = async (file) => {
    if (!file) return;
    if (!globalThis.Tesseract) {
      toast('OCR indisponível. Recarregue o app com internet.');
      return;
    }

    let worker = null;
    toast('Preparando imagem...');

    try {
      const canvas = await preprocessImage(file);

      worker = await Tesseract.createWorker('por', 1, {
        logger: (message) => {
          if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
            const percent = Math.round(message.progress * 100);
            if (percent === 25 || percent === 50 || percent === 75 || percent === 100) {
              toast(`Lendo comprovante... ${percent}%`);
            }
          }
        }
      });

      const { data: { text = '' } = {} } = await worker.recognize(canvas);
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const cleanedText = lines.join('\n');

      if (!cleanedText) throw new Error('O OCR não encontrou texto na imagem.');

      const value = extractValue(lines);
      const date = extractDate(cleanedText);
      const merchant = extractMerchant(lines);
      const category = chooseCategory(cleanedText);
      const payment = detectPayment(cleanedText);

      if (value > 0) setFieldValue('entryValue', value.toFixed(2));
      setFieldValue('entryDate', date);
      setFieldValue('entryDescription', merchant, { onlyIfEmpty: true });
      if (category) setFieldValue('entryCategory', category);
      if (payment) setFieldValue('entryPayment', payment);
      setFieldValue('entryNote', 'Dados preenchidos por leitura de comprovante. Confira antes de salvar.', { onlyIfEmpty: true });

      if (value > 0) toast('Comprovante lido. Confira os dados antes de salvar.');
      else toast('Texto reconhecido, mas o valor total não foi identificado. Confira os campos.');
    } catch (error) {
      console.error('Erro no OCR:', error);
      toast(error?.message || 'Erro ao processar a imagem.');
    } finally {
      if (worker) {
        try { await worker.terminate(); } catch (error) { console.warn('Falha ao encerrar OCR:', error); }
      }
    }
  };

  const openScanner = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.hidden = true;

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (file) await processReceipt(file);
      input.remove();
    }, { once: true });

    document.body.appendChild(input);
    input.click();
  };

  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('entryForm');
    if (!form || document.getElementById('scanReceiptBtn')) return;

    const button = document.createElement('button');
    button.id = 'scanReceiptBtn';
    button.type = 'button';
    button.className = 'secondary-paper-button';
    button.textContent = '📸 Ler comprovante';
    button.style.marginBottom = '12px';
    button.addEventListener('click', openScanner);

    const noteField = document.getElementById('entryNote');
    const noteLabel = noteField?.closest('.form-field');
    if (noteLabel) form.insertBefore(button, noteLabel);
    else form.appendChild(button);
  });
})();
