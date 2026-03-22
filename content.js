// FaceDong Filter
// Simplified version: Filters based on visible Title and Price in the grid.

let userSettings = {
  enabled: true,
  minPrice: 0,
  maxPrice: 30000000,
  excludeKeywords: ["studio", "CT1", "chung cư"],
  includeKeywords: []
};

let deepScanInProgress = false;
let deepScanQueueLength = 0;

// Load settings
const loadSettings = () => {
  chrome.storage.sync.get(['settings'], (result) => {
    if (result.settings) {
      userSettings = { ...userSettings, ...result.settings };
      applyFilterToAll();
    }
  });
};

const performDeepScan = async (url) => {
  const clickSeeMore = () => {
    return new Promise(resolve => {
      const allDivs = Array.from(document.querySelectorAll('div'));
      const descDiv = allDivs.find(d => d.innerText.trim() === 'Description' || d.innerText.trim() === 'Mô tả');
      if (descDiv) {
        let current = descDiv;
        while (current && current !== document.body) {
          const seeMore = Array.from(current.querySelectorAll('div[role="button"], span[dir="auto"]')).find(el => {
            const txt = el.innerText.trim().toLowerCase();
            return txt === 'see more' || txt === 'xem thêm';
          });
          if (seeMore) {
            seeMore.click();
            setTimeout(resolve, 800);
            return;
          }
          current = current.parentElement;
        }
      }
      resolve();
    });
  };

  await clickSeeMore();
  
  const listingText = document.body.innerText;
  const textLower = listingText.toLowerCase();
  
  const excludeKws = parseKeywords(userSettings.excludeKeywords.join(','));
  const includeKws = parseKeywords(userSettings.includeKeywords.join(','));

  let filterReason = "";

  // Find price-like string for normalizePrice
  const priceMatch = textLower.match(/(?:(?:₫|\$)\s*\d+[\d.,]*|\d+[\d.,]*\s*(?:tr|triệu|vnd|million|đ|₫|k)\b)/);
  const normalizedPrice = priceMatch ? normalizePrice(priceMatch[0], listingText) : null;
  
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

// Listener for settings updates
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "updateSettings") {
    userSettings = { ...userSettings, ...request.settings };
    applyFilterToAll();
  } else if (request.action === "deepScanProgress") {
    deepScanQueueLength = request.remaining;
    updateStatusBar();
  } else if (request.action === "deepScanComplete") {
    deepScanInProgress = false;
    updateStatusBar();
  } else if (request.action === "updateListing") {
    const listings = document.querySelectorAll('a[href*="/marketplace/item/"]');
    listings.forEach(link => {
      if (link.href.includes(request.url)) {
        const container = link.closest('div[style*="max-width"]') || link.parentElement;
        if (container && request.reason) {
          container.classList.add('fb-filter-dimmed');
          const oldBadge = container.querySelector('.ntmf-reason-badge');
          if (oldBadge) oldBadge.remove();
          const badge = document.createElement('div');
          badge.className = 'ntmf-reason-badge';
          badge.innerText = 'Deep: ' + request.reason;
          badge.style.background = 'purple';
          container.appendChild(badge);
        }
      }
    });
  } else if (request.action === "performDeepScan") {
    performDeepScan(request.url).then(reason => {
      chrome.runtime.sendMessage({ action: 'deepScanResult', url: request.url, reason });
    });
  } else if (request.action === "clearCache") {
    const badges = document.querySelectorAll('.ntmf-reason-badge');
    badges.forEach(b => b.remove());
    const dimmed = document.querySelectorAll('.fb-filter-dimmed');
    dimmed.forEach(d => d.classList.remove('fb-filter-dimmed'));
    applyFilterToAll();
  }
});

const filterListing = (container) => {
  const oldBadge = container.querySelector('.ntmf-reason-badge');
  if (oldBadge && !oldBadge.innerText.startsWith('Deep:')) oldBadge.remove();

  if (!userSettings.enabled) {
    container.classList.remove('fb-filter-dimmed');
    return false;
  }

  // If already deep filtered, don't remove it
  if (oldBadge && oldBadge.innerText.startsWith('Deep:')) {
    container.classList.add('fb-filter-dimmed');
    return true;
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

let stats = { total: 0, filtered: 0 };

const startDeepScan = () => {
  if (deepScanInProgress) return;
  const listings = document.querySelectorAll('a[href*="/marketplace/item/"]');
  const urlsToScan = [];
  listings.forEach(link => {
    const container = link.closest('div[style*="max-width"]') || link.parentElement;
    if (container && !container.classList.contains('fb-filter-dimmed')) {
      const url = new URL(link.href);
      url.search = ''; // Clean params
      if (!urlsToScan.includes(url.href)) urlsToScan.push(url.href);
    }
  });
  
  if (urlsToScan.length === 0) return alert('No unfiltered items to DeepScan.');
  
  deepScanInProgress = true;
  deepScanQueueLength = urlsToScan.length;
  updateStatusBar();
  
  chrome.runtime.sendMessage({ action: 'startDeepScan', urls: urlsToScan });
};

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
      display: flex; align-items: center;
    `;
    
    const textSpan = document.createElement('span');
    textSpan.id = 'ntmf-status-text';
    bar.appendChild(textSpan);

    const dsBtn = document.createElement('button');
    dsBtn.id = 'ntmf-deepscan-btn';
    dsBtn.innerText = 'DeepScan';
    dsBtn.style.cssText = 'margin-left: 10px; background: white; color: black; border: none; padding: 4px 8px; border-radius: 10px; cursor: pointer; font-size: 11px; font-weight: bold;';
    dsBtn.onclick = startDeepScan;
    bar.appendChild(dsBtn);

    document.body.appendChild(bar);
  }
  return bar;
};

const updateStatusBar = (isScanning = false) => {
  const bar = createStatusBar();
  bar.style.opacity = '1';
  
  const textSpan = document.getElementById('ntmf-status-text');
  let dsText = deepScanInProgress ? ` | DeepScan: ${deepScanQueueLength} left` : '';
  textSpan.innerHTML = `${isScanning ? '🔍 Scanning... ' : '✅ '} Filtered ${stats.filtered} of ${stats.total}${dsText}`;
  
  const dsBtn = document.getElementById('ntmf-deepscan-btn');
  dsBtn.disabled = deepScanInProgress;
  dsBtn.style.opacity = deepScanInProgress ? '0.5' : '1';
  dsBtn.innerText = deepScanInProgress ? 'Scanning...' : 'DeepScan';

  if (!isScanning && !deepScanInProgress) setTimeout(() => { bar.style.opacity = '0.7'; }, 3000);
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
