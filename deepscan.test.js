const { normalizePrice, parseKeywords } = require('./utils');

describe('DeepScan filter logic', () => {
  const userSettings = {
    minPrice: 0,
    maxPrice: 30000000,
    excludeKeywords: ["studio", "CT1"],
    includeKeywords: []
  };

  const applyLogic = (textLower) => {
    let filterReason = "";
    
    const excludeKws = parseKeywords(userSettings.excludeKeywords.join(','));
    const includeKws = parseKeywords(userSettings.includeKeywords.join(','));

    const priceMatch = textLower.match(/(?:(?:₫|\$)\s*\d+[\d.,]*|\d+[\d.,]*\s*(?:tr|triệu|vnd|million|đ|₫|k)\b)/);
    const normalizedPrice = priceMatch ? normalizePrice(priceMatch[0], textLower) : null;
    
    if (normalizedPrice !== null) {
      if (normalizedPrice < userSettings.minPrice) filterReason = `Price too low (${(normalizedPrice/1000000).toFixed(1)}M)`;
      else if (normalizedPrice > userSettings.maxPrice) filterReason = `Price too high (${(normalizedPrice/1000000).toFixed(1)}M)`;
    }

    if (!filterReason && excludeKws.length > 0) {
      const matched = excludeKws.find(kw => textLower.includes(kw));
      if (matched) filterReason = `Has word: "${matched}"`;
    }

    if (!filterReason && includeKws.length > 0) {
      const matched = includeKws.some(kw => textLower.includes(kw));
      if (!matched) filterReason = `Missing required keywords`;
    }
    
    return filterReason;
  };

  it('filters by extracted price from description', () => {
    // 35 triệu is > 30m
    const text = 'Beautiful house in hanoi. Price is 35 triệu. Call me.'.toLowerCase();
    expect(applyLogic(text)).toBe('Price too high (35.0M)');
  });

  it('filters by exclude keywords from description', () => {
    const text = 'This is a nice studio apartment. 10 tr/month.'.toLowerCase();
    expect(applyLogic(text)).toBe('Has word: "studio"');
  });

  it('allows valid listings', () => {
    const text = '2 bedroom apartment with good view. 15 triệu. Contact soon.'.toLowerCase();
    expect(applyLogic(text)).toBe('');
  });
});
