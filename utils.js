const normalizePrice = (val) => {
  if (isNaN(val) || val <= 0) return null;

  // Case 1: 0.1 - 99 (e.g., 5.5, 15) -> Millions
  if (val < 100) {
    return val * 1000000;
  }

  // Case 2: 100 - 999 (e.g., 135) -> 13.5M
  if (val >= 100 && val < 1000) {
    return val * 100000;
  }

  // Case 3: 1000 - 99999 (e.g., 13000) -> 13,000,000
  if (val >= 1000 && val < 100000) {
    return val * 1000;
  }

  // Case 4: 100,000+ -> Keep as is (Full price)
  return val;
};

const extractPrice = (text) => {
  if (!text) return null;
  const textLower = text.toLowerCase();
  
  if (textLower.includes('free')) return null;

  const priceRegex = /(?<!\/\s*)(?:\$|₫|vnd|đ)?\s*(\d+(?:[\s.,]\d+)*)\s*(tr\b|triệu\b|million\b|vnd\b|đ\b|₫\b|k\b|\$)?/gi;
  
  let matches = [];
  let match;
  
  while ((match = priceRegex.exec(textLower)) !== null) {
    let numStr = match[1].replace(/\s/g, '');
    const seps = (numStr.match(/[.,]/g) || []).length;
    
    if (seps > 1) {
      numStr = numStr.replace(/[.,]/g, '');
    } else if (seps === 1) {
      const parts = numStr.split(/[.,]/);
      if (parts[1].length === 3) numStr = numStr.replace(/[.,]/, '');
      else numStr = parts[0] + '.' + parts[1];
    }

    const val = parseFloat(numStr);
    const unit = (match[2] || "").toLowerCase();
    
    if (!isNaN(val) && val > 0) {
      let finalVal = (unit === 'k') ? val * 1000 : normalizePrice(val);
      
      if (finalVal) {
        // Rank units: 3 = million-based, 2 = currency, 1 = k, 0 = none
        let rank = 0;
        if (unit.match(/tr|triệu|million/)) rank = 3;
        else if (unit.match(/vnd|đ|₫|\$/)) rank = 2;
        else if (unit === 'k') rank = 1;

        matches.push({ value: finalVal, rank: rank });
      }
    }
  }

  if (matches.length === 0) return null;

  // Filter out suspiciously low prices (fees, utilities) if we have better candidates
  // In rental market, anything < 500k is likely a fee, not rent.
  const reasonablePrices = matches.filter(m => m.value >= 500000);
  const candidates = reasonablePrices.length > 0 ? reasonablePrices : matches;

  // Priority: 
  // 1. Highest rank (prefer 'tr' over 'k' over plain numbers)
  // 2. Smallest value within that rank (to pick rent over deposit)
  const maxRank = Math.max(...candidates.map(m => m.rank));
  const topRanked = candidates.filter(m => m.rank === maxRank);
  
  return Math.min(...topRanked.map(m => m.value));
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
  module.exports = { normalizePrice, extractPrice, parseKeywords };
} else {
  window.utils = { normalizePrice, extractPrice, parseKeywords };
}
