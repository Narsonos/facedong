// FaceDong Filter
// Simplified version: Filters based on visible Title and Price in the grid.

let userSettings = {
  enabled: true,
  minPrice: 0,
  maxPrice: 30000000,
  excludeKeywords: ["studio", "CT1", "chung cư"],
  includeKeywords: []
};

// Load settings
const loadSettings = () => {
  chrome.storage.sync.get(['settings'], (result) => {
    if (result.settings) {
      userSettings = { ...userSettings, ...result.settings };
      applyFilterToAll();
    }
  });
};

// Listener for settings updates
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "updateSettings") {
    userSettings = { ...userSettings, ...request.settings };
    applyFilterToAll();
  }
});

/**
 * Normalizes Vietnamese rental prices.
 */
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

let stats = { total: 0, filtered: 0 };

const createStatusBar = () => {
  let bar = document.getElementById('ntmf-status-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'ntmf-status-bar';
    bar.style.cssText = `
      position: fixed; bottom: 20px; right: 20px;
      background: rgba(8, 102, 255, 0.9); color: white;
      padding: 8px 15px; border-radius: 20px;
      font-size: 12px; font-weight: bold; z-index: 9999;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2); transition: opacity 0.5s;
      pointer-events: none;
    `;
    document.body.appendChild(bar);
  }
  return bar;
};

const updateStatusBar = (isScanning = false) => {
  const bar = createStatusBar();
  bar.style.opacity = '1';
  bar.innerHTML = `${isScanning ? '🔍 Scanning... ' : '✅ '} Filtered ${stats.filtered} of ${stats.total}`;
  if (!isScanning) setTimeout(() => { bar.style.opacity = '0.7'; }, 3000);
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

const filterListing = (container) => {
  const oldBadge = container.querySelector('.ntmf-reason-badge');
  if (oldBadge) oldBadge.remove();

  if (!userSettings.enabled) {
    container.classList.remove('fb-filter-dimmed');
    return false;
  }

  const anchor = container.querySelector('a[href*="/marketplace/item/"]') || container;
  const label = anchor.getAttribute('aria-label') || "";
  
  const textLines = (container.innerText || "").split('\n');
  const priceLine = textLines.find(line => {
    const t = line.toLowerCase();
    return t.includes('₫') || t.includes('$') || t.includes('price') || t.includes('free') || t.includes('miễn phí');
  });

  let priceRaw = "";
  if (priceLine) {
    priceRaw = priceLine;
  } else if (label) {
    const parts = label.split(' · ');
    priceRaw = parts.find(p => {
      const pt = p.toLowerCase();
      return pt.includes('₫') || pt.includes('$') || pt.includes('price') || pt.includes('free') || pt.includes('miễn phí') || /^\s*[\d\s.,]+(tr|triệu|k)?\s*$/.test(pt); 
    }) || "";
  }

  const listingText = container.innerText;
  const normalizedPrice = normalizePrice(priceRaw, listingText);
  const textLower = listingText.toLowerCase();
  
  const excludeKws = parseKeywords(userSettings.excludeKeywords.join(','));
  const includeKws = parseKeywords(userSettings.includeKeywords.join(','));

  let filterReason = "";

  // 1. Price Check
  if (normalizedPrice !== null) {
    if (normalizedPrice < userSettings.minPrice) filterReason = `Price too low (${(normalizedPrice/1000000).toFixed(1)}M)`;
    else if (normalizedPrice > userSettings.maxPrice) filterReason = `Price too high (${(normalizedPrice/1000000).toFixed(1)}M)`;
  }

  // 2. Exclude Keywords
  if (!filterReason && excludeKws.length > 0) {
    const matched = excludeKws.find(kw => textLower.includes(kw));
    if (matched) filterReason = `Has word: "${matched}"`;
  }

  // 3. Include Keywords
  if (!filterReason && includeKws.length > 0) {
    const matched = includeKws.some(kw => textLower.includes(kw));
    if (!matched) filterReason = `Missing required keywords`;
  }

  if (filterReason) {
    container.classList.add('fb-filter-dimmed');
    const badge = document.createElement('div');
    badge.className = 'ntmf-reason-badge';
    badge.innerText = filterReason;
    container.appendChild(badge);
    return true;
  } else {
    container.classList.remove('fb-filter-dimmed');
    return false;
  }
};

const applyFilterToAll = () => {
  updateStatusBar(true);
  const listings = document.querySelectorAll('a[href*="/marketplace/item/"]');
  stats.total = 0;
  stats.filtered = 0;
  
  const processedContainers = new Set();

  listings.forEach(link => {
    const container = link.closest('div[style*="max-width"]') || link.parentElement;
    if (container && !processedContainers.has(container)) {
      processedContainers.add(container);
      stats.total++;
      if (filterListing(container)) stats.filtered++;
    }
  });
  updateStatusBar(false);
};

const observer = new MutationObserver((mutations) => {
  let needsUpdate = false;
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.nodeType === 1) {
        if (node.querySelector && (node.querySelector('a[href*="/marketplace/item/"]') || node.matches('a[href*="/marketplace/item/"]'))) {
          needsUpdate = true;
        }
      }
    });
  });
  
  if (needsUpdate) {
    clearTimeout(window.ntmfTimer);
    window.ntmfTimer = setTimeout(applyFilterToAll, 500);
  }
});

const init = () => {
  loadSettings();
  observer.observe(document.body, { childList: true, subtree: true });
  console.log("[FaceDong] Initialized.");
};

const waitForDOM = setInterval(() => {
  if (document.querySelector('a[href*="/marketplace/item/"]')) {
    clearInterval(waitForDOM);
    init();
  }
}, 1000);
