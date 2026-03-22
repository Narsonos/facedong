const normalizePrice = (priceStr, contextText) => {
  if (!priceStr) return null;
  
  const original = priceStr.toLowerCase();
  
  // Case: "Free" / "0" / "Miễn phí"
  if (original.includes('free') || original.includes('miễn') || original.replace(/[^\d]/g, '') === '0') {
    const priceMatch = contextText.toLowerCase().match(/(\d+[.,]?\d*)\s*(tr|triệu|vnd|million|đ|₫)\b/);
    if (priceMatch) {
      let val = parseFloat(priceMatch[1].replace(',', '.'));
      if (!isNaN(val) && val > 0) {
        let result = val;
        while (result > 0 && result < 1000000) result *= 10;
        return result;
      }
    }
    return null; 
  }
  
  let cleaned = original.replace(/[₫vndđ$]/gi, '');
  const match = cleaned.match(/\d+([\s.,]+\d+)*/);
  if (!match) return null;
  
  let numStr = match[0].replace(/\s/g, ''); 
  const seps = (numStr.match(/[.,]/g) || []).length;
  if (seps > 1) {
    numStr = numStr.replace(/[.,]/g, '');
  } else if (seps === 1) {
    const parts = numStr.split(/[.,]/);
    if (parts[1].length === 3) numStr = numStr.replace(/[.,]/, '');
    else numStr = parts[0] + '.' + parts[1];
  }

  let val = parseFloat(numStr);
  if (isNaN(val) || val === 0) return null;

  if (val >= 1000000) return val;

  let result = val;
  if (result < 100) result *= 1000000;
  else if (result >= 100 && result < 1000) result *= 100000;
  else if (result >= 1000 && result < 10000) {
      let scaled = result * 1000;
      if (scaled < 3000000) result *= 10000;
      else result = scaled;
  } else if (result >= 10000 && result < 100000) result *= 1000;
  else {
      while (result > 0 && result < 1000000) result *= 10;
  }
  
  return result;
};

const parseKeywords = (input) => {
  if (!input) return [];
  const regex = /"([^"]+)"|([^,]+)/g;
  const keywords = [];
  let match;
  while ((match = regex.exec(input)) !== null) {
    const kw = (match[1] || match[2]).trim();
    if (kw) keywords.push(kw.toLowerCase());
  }
  return keywords;
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizePrice, parseKeywords };
} else {
  window.utils = { normalizePrice, parseKeywords };
}
