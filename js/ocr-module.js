// js/ocr-module.js
// OCR helper for receipt scanning
// Requires Tesseract.js loaded on page

const processReceipt = async (file) => {
  showToast('Processando imagem...');
  try {
    const worker = await Tesseract.createWorker();
    await worker.load();
    const { data: { text } } = await worker.recognize(file);
    await worker.terminate();
    // Extract value
    let value = 0;
    const valMatch = text.match(/[0-9]{1,3}(?:[.,][0-9]{3})*(?:,1[0-9])?|(\d+,\d{2})/);
    if (valMatch) {
      value = parseFloat(valMatch[0].replace(/\./g, '').replace(',', '.'));
    }
    // Extract date
    let date = new Date().toISOString().split('T')[0];
    const dateMatch = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})|(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/);
    if (dateMatch) {
      const raw = dateMatch[0];
      if (raw.includes('/')) {
        const parts = raw.split('/');
        date = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
      } else {
        date = raw;
      }
    }
    // Category based on text content
    let category = 'Outros';
    if (Array.isArray(globalThis.categories)) {
      for (const c of globalThis.categories) {
        if (text.toLowerCase().includes(c.toLowerCase())) {
          category = c;
          break;
        }
      }
    }
    // Update fields
    const valField = document.getElementById('entryValue');
    const dateField = document.getElementById('entryDate');
    const catField = document.getElementById('entryCategory');
    if (valField) valField.value = value.toFixed(2);
    if (dateField) dateField.value = date;
    if (catField) catField.value = category;
    showToast('Captura concluída!');
  } catch (e) {
    console.error('Error processing OCR', e);
    showToast('Erro ao processar imagem.');
  }
};

const openScanner = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';
  input.onchange = async (e) => {
    if (e.target.files && e.target.files[0]) {
      await processReceipt(e.target.files[0]);
    }
  };
  input.click();
};

// Inject scan button into modal form
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('entryForm');
  if (!form) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'primary-paper-button';
  btn.textContent = '📸 Escanear';
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    openScanner();
  });
  // Insert before the note field
  const noteField = document.getElementById('entryNote');
  if (noteField) {
    noteField.parentNode.parentNode.insertBefore(btn, noteField.parentNode);
  } else {
    form.appendChild(btn);
  }
});
