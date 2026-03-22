const { extractPrice, parseKeywords } = require('./utils');

describe('DeepScan filter logic', () => {
  const userSettings = {
    minPrice: 5000000,
    maxPrice: 30000000,
    excludeKeywords: ["studio", "CT1"],
    includeKeywords: []
  };

  const applyLogic = (text) => {
    let filterReason = "";
    
    const excludeKws = parseKeywords(userSettings.excludeKeywords.join(','));
    const includeKws = parseKeywords(userSettings.includeKeywords.join(','));

    const normalizedPrice = extractPrice(text);
    
    if (normalizedPrice !== null) {
      if (normalizedPrice < userSettings.minPrice) filterReason = `Price too low (${(normalizedPrice/1000000).toFixed(1)}M)`;
      else if (normalizedPrice > userSettings.maxPrice) filterReason = `Price too high (${(normalizedPrice/1000000).toFixed(1)}M)`;
    }

    if (!filterReason && excludeKws.length > 0) {
      const matched = excludeKws.find(kw => text.toLowerCase().includes(kw));
      if (matched) filterReason = `Has word: "${matched}"`;
    }

    if (!filterReason && includeKws.length > 0) {
      const matched = includeKws.some(kw => text.toLowerCase().includes(kw));
      if (!matched) filterReason = `Missing required keywords`;
    }
    
    return filterReason;
  };

  it('filters by extracted price from description (too high)', () => {
    // 35 triệu is > 30m
    const text = 'Beautiful house in hanoi. Price is 35 triệu. Call me.';
    expect(applyLogic(text)).toBe('Price too high (35.0M)');
  });

  it('filters by extracted price from description (too low)', () => {
    // 2 triệu is < 5m
    const text = 'Cheap room for rent. Only 2tr. Contact me.';
    expect(applyLogic(text)).toBe('Price too low (2.0M)');
  });

  it('filters by exclude keywords from description', () => {
    const text = 'This is a nice studio apartment. 10 tr/month.';
    expect(applyLogic(text)).toBe('Has word: "studio"');
  });

  it('allows valid listings', () => {
    const text = '2 bedroom apartment with good view. 15 triệu. Contact soon.';
    expect(applyLogic(text)).toBe('');
  });

  it('chooses the smallest non-zero price with unit (to avoid deposit)', () => {
    // 15tr rent, 30tr deposit. Should pick 15tr.
    const text = 'Gia thue 15tr, coc 30tr. Dep lam.';
    expect(applyLogic(text)).toBe(''); // 15M is within [5M, 30M]
  });

  it('handles multiple numbers and picks the one with currency unit', () => {
    // 2 is bedroom count, 15 is price.
    const text = 'Can ho 2 phong ngu, gia 15tr.';
    expect(extractPrice(text)).toBe(15000000);
  });
});
