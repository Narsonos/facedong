const { normalizePrice } = require('./utils');

describe('normalizePrice', () => {
  it('handles standard millions', () => {
    expect(normalizePrice('5 tr', '')).toBe(5000000);
    expect(normalizePrice('5.5 triệu', '')).toBe(5500000);
    expect(normalizePrice('15', '')).toBe(15000000);
  });
  it('handles thousands', () => {
    expect(normalizePrice('5000k', '')).toBe(5000000);
    expect(normalizePrice('3500', '')).toBe(3500000);
  });
  it('handles full numbers', () => {
    expect(normalizePrice('5000000', '')).toBe(5000000);
    expect(normalizePrice('5.000.000', '')).toBe(5000000);
    expect(normalizePrice('5,000,000', '')).toBe(5000000);
  });
  it('handles free/0 with context', () => {
    expect(normalizePrice('Free', 'Beautiful house, 5tr/month')).toBe(5000000);
    expect(normalizePrice('0 ₫', 'Giá 3.5 triệu')).toBe(3500000);
  });
  it('returns null for unparseable', () => {
    expect(normalizePrice('abc', '')).toBeNull();
  });
});
