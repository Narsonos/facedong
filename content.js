// FaceDong Filter
// Simplified version: Filters based on visible Title and Price in the grid.

let userSettings = {
  enabled: true,
  minPrice: 0,
  maxPrice: 30000000,
  excludeKeywords: ["studio", "CT1", "chung cư"],
  includeKeywords: [],
  deepScanWorkers: 1
};

let deepScanInProgress = false;
let deepScanQueueLength = 0;

function setCardDimmed(container, isDimmed) {
  if (isDimmed) {
    container.classList.add('fb-filter-dimmed');
  } else {
    container.classList.remove('fb-filter-dimmed');
  }
}

function addBadge(container, text, bgColor = null, textColor = null) {
  const oldBadge = container.querySelector('.ntmf-reason-badge');
  if (oldBadge) oldBadge.remove();

  if (window.getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }

  const badge = document.createElement('div');
  badge.className = 'ntmf-reason-badge';
  badge.innerText = text;
  if (bgColor) badge.style.background = bgColor;
  if (textColor) badge.style.color = textColor;
  container.appendChild(badge);
}

// Load settings
const loadSettings = (isDeepScan = false) => {
  chrome.storage.sync.get(['settings'], (result) => {
    if (result.settings) {
      userSettings = { ...userSettings, ...result.settings };
      if (!isDeepScan) applyFilterToAll();
    }
  });
};

const performDeepScan = async (url, existingPrice) => {
  // Check cache first
  const cacheKey = `ds_${url}`;
  const cached = await new Promise(resolve => chrome.storage.local.get([cacheKey], res => resolve(res[cacheKey])));
  if (cached !== undefined) return cached;

  const getListingContainer = () => {
    return new Promise(resolve => {
      let attempts = 0;
      const check = () => {
        const allDivs = Array.from(document.querySelectorAll('div, span'));
        const descDiv = allDivs.find(d => d.innerText && (d.innerText.trim() === 'Description' || d.innerText.trim() === 'Mô tả'));
        
        // Also check if the price element is already there
        const priceSpan = allDivs.find(s => {
          const text = s.innerText || "";
          return (text.includes('₫') || text.includes('$')) && 
                 (text.toLowerCase().includes('/ month') || text.toLowerCase().includes('/ tháng'));
        });

        if (descDiv || priceSpan || attempts > 30) {
          if (descDiv) {
            let current = descDiv;
            let container = null;
            while (current && current !== document.body) {
              if (!container && current.innerText.length > descDiv.innerText.length + 15) {
                container = current;
              }
              const seeMore = Array.from(current.querySelectorAll('div[role="button"], span[dir="auto"]')).find(el => {
                const txt = el.innerText ? el.innerText.trim().toLowerCase() : '';
                return txt === 'see more' || txt === 'xem thêm';
              });
              if (seeMore) {
                seeMore.click();
                setTimeout(() => resolve(current), 400);
                return;
              }
              current = current.parentElement;
            }
            resolve(container || descDiv.parentElement || document.body);
          } else {
            const main = document.querySelector('[role="main"]');
            resolve(main || document.body);
          }
        } else {
          attempts++;
          setTimeout(check, 100);
        }
      };
      check();
    });
  };

  const container = await getListingContainer();

  // Try to find the specific price element (e.g., "13 ₫ / Month")
  let targetPrice = existingPrice;
  const allSpans = Array.from(document.querySelectorAll('span'));
  const priceSpan = allSpans.find(s => {
    const text = s.innerText || "";
    return (text.includes('₫') || text.includes('$')) && 
           (text.toLowerCase().includes('/ month') || text.toLowerCase().includes('/ tháng') || text.toLowerCase().includes('per month'));
  });

  if (priceSpan) {
    const parsed = extractPrice(priceSpan.innerText);
    if (parsed !== null) targetPrice = parsed;
  }

  // Physically hide "Today's picks" and anything after it to prevent parser from catching extra text
  const walkAndHideSiblings = (node) => {
    let current = node;
    while (current && current !== document.body) {
      let sibling = current.nextElementSibling;
      while (sibling) {
        sibling.style.display = 'none';
        sibling = sibling.nextElementSibling;
      }
      current = current.parentElement;
    }
  };

  const todaysPicksHeaders = Array.from(document.querySelectorAll('h2, span, div')).filter(el => el.innerText && el.innerText.trim().toLowerCase() === "today's picks");
  todaysPicksHeaders.forEach(el => {
    el.style.display = 'none';
    walkAndHideSiblings(el);
  });

  const listingText = container.innerText;
  const textLower = listingText.toLowerCase();
  
  const excludeKws = parseKeywords(userSettings.excludeKeywords.join(','));
  const includeKws = parseKeywords(userSettings.includeKeywords.join(','));

  let filterReason = "";

  // Only check price in description if it wasn't found in the grid or the specific price element
  const normalizedPrice = (targetPrice !== null && targetPrice !== undefined) ? targetPrice : extractPrice(listingText);
  
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

  // Save to cache
  chrome.storage.local.set({ [cacheKey]: filterReason });
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
  } else if (request.action === "deepScanStatus") {
    const listings = document.querySelectorAll('a[href*="/marketplace/item/"]');
    listings.forEach(link => {
      if (link.href.includes(request.url)) {
        const container = link.closest('div[style*="max-width"]') || link.parentElement;
        if (container) {
          const badge = container.querySelector('.ntmf-reason-badge');
          if (badge) {
            badge.innerText = 'Deep: ' + request.status;
            badge.style.background = '#0866ff'; 
            badge.style.color = 'white';
          }
        }
      }
    });
  } else if (request.action === "updateListing") {
    const listings = document.querySelectorAll('a[href*="/marketplace/item/"]');
    listings.forEach(link => {
      if (link.href.includes(request.url)) {
        const container = link.closest('div[style*="max-width"]') || link.parentElement;
        if (container) {
          if (request.reason) {
            setCardDimmed(container, true);
            addBadge(container, 'Deep: ' + request.reason, '#0866ff', 'white');
          } else {
            setCardDimmed(container, false);
            const oldBadge = container.querySelector('.ntmf-reason-badge');
            if (oldBadge) oldBadge.remove();
          }
        }
      }
    });
  } else if (request.action === "performDeepScan") {
    performDeepScan(request.url, request.existingPrice).then(reason => {
      chrome.runtime.sendMessage({ action: 'deepScanResult', url: request.url, reason });
    });
  } else if (request.action === "clearCache") {
    const badges = document.querySelectorAll('.ntmf-reason-badge');
    badges.forEach(b => b.remove());
    const dimmed = document.querySelectorAll('.fb-filter-dimmed');
    dimmed.forEach(d => setCardDimmed(d, false));
    applyFilterToAll();
  }
});

const filterListing = (container, cache = {}) => {
  const oldBadge = container.querySelector('.ntmf-reason-badge');
  
  if (oldBadge) {
    const text = oldBadge.innerText;
    // If currently scanning or queued - NO DIMMING, and don't remove the badge
    if (text.includes('Queued') || text.includes('Scanning')) {
      setCardDimmed(container, false);
      return false;
    }
    // Remove old non-Deep badges to re-evaluate
    if (!text.startsWith('Deep:')) {
      oldBadge.remove();
    }
  }

  if (!userSettings.enabled) {
    setCardDimmed(container, false);
    return false;
  }

  const anchor = container.querySelector('a[href*="/marketplace/item/"]') || container;
  const urlObj = new URL(anchor.href);
  urlObj.search = '';
  const cleanUrl = urlObj.href;

  // 1. Check cache FIRST (Automatic application)
  const cachedReason = cache[`ds_${cleanUrl}`];
  if (cachedReason !== undefined) {
    if (cachedReason) {
      setCardDimmed(container, true);
      addBadge(container, 'Deep: ' + cachedReason, '#0866ff', 'white');
      return true;
    } else {
      // Valid cached listing - ensure no dimming and no deep badges
      setCardDimmed(container, false);
      if (oldBadge && oldBadge.innerText.startsWith('Deep:')) oldBadge.remove();
      // Continue to check grid-level filters (price/kws) below
    }
  }

  const label = anchor.getAttribute('aria-label') || "";
  const textLines = (container.innerText || "").split('\n');
  const priceLine = textLines.find(line => {
    const t = line.toLowerCase();
    return t.includes('₫') || t.includes('$') || t.includes('price') || t.includes('free');
  });

  let priceRaw = "";
  if (priceLine) {
    if (priceLine.toLowerCase().includes('free')) {
      priceRaw = ""; 
    } else {
      priceRaw = priceLine;
    }
  } else if (label) {
    const parts = label.split(' · ');
    priceRaw = parts.find(p => {
      const pt = p.toLowerCase();
      return pt.includes('₫') || pt.includes('$') || pt.includes('price') || pt.includes('free') || pt.includes('miễn phí') || /^\s*[\d\s.,]+(tr|triệu|k)?\s*$/.test(pt); 
    }) || "";
  }

  const listingText = container.innerText;
  const normalizedPrice = extractPrice(priceRaw || listingText);
  const textLower = listingText.toLowerCase();
  
  const excludeKws = parseKeywords(userSettings.excludeKeywords.join(','));
  const includeKws = parseKeywords(userSettings.includeKeywords.join(','));

  let filterReason = "";

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

  if (filterReason) {
    setCardDimmed(container, true);
    addBadge(container, filterReason);
    return true;
  } else {
    setCardDimmed(container, false);
    return false;
  }
};

let stats = { total: 0, filtered: 0 };

const startDeepScan = async () => {
  if (deepScanInProgress) return;
  const listings = document.querySelectorAll('a[href*="/marketplace/item/"]');
  const urlsToScan = [];
  
  const allCache = await new Promise(resolve => chrome.storage.local.get(null, resolve));

  listings.forEach(link => {
    const container = link.closest('div[style*="max-width"]') || link.parentElement;
    if (container && !container.classList.contains('fb-filter-dimmed')) {
      const url = new URL(link.href);
      url.search = ''; 
      const cleanUrl = url.href;
      
      const cachedReason = allCache[`ds_${cleanUrl}`];
      if (cachedReason !== undefined) {
        if (cachedReason) {
          setCardDimmed(container, true);
          addBadge(container, 'Deep: ' + cachedReason, '#0866ff', 'white');
        } else {
          setCardDimmed(container, false);
          const badge = container.querySelector('.ntmf-reason-badge');
          if (badge && badge.innerText.startsWith('Deep:')) badge.remove();
        }
        return;
      }

      const label = link.getAttribute('aria-label') || "";
      const textLines = (container.innerText || "").split('\n');
      const priceLine = textLines.find(line => {
        const t = line.toLowerCase();
        return t.includes('₫') || t.includes('$') || t.includes('price') || t.includes('free');
      });
      let priceRaw = priceLine && !priceLine.toLowerCase().includes('free') ? priceLine : "";
      if (!priceRaw && label) {
          const parts = label.split(' · ');
          priceRaw = parts.find(p => p.includes('₫') || p.includes('$')) || "";
      }
      const existingPrice = extractPrice(priceRaw);

      if (!urlsToScan.find(u => u.url === cleanUrl)) {
        urlsToScan.push({ url: cleanUrl, existingPrice: existingPrice });
      }
      addBadge(container, 'Queued', '#0866ff', 'white');
    }
  });
  
  if (urlsToScan.length === 0) {
    applyFilterToAll(); 
    return;
  }
  
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

  if (!isScanning && !deepScanInProgress) setTimeout(() => { bar.style.opacity = '0.7'; }, 1500);
};

const applyFilterToAll = async () => {
  updateStatusBar(true);
  const listings = document.querySelectorAll('a[href*="/marketplace/item/"]');
  stats.total = 0;
  stats.filtered = 0;
  
  const cache = await new Promise(resolve => chrome.storage.local.get(null, resolve));
  const processedContainers = new Set();

  listings.forEach(link => {
    const container = link.closest('div[style*="max-width"]') || link.parentElement;
    if (container && !processedContainers.has(container)) {
      processedContainers.add(container);
      stats.total++;
      if (filterListing(container, cache)) stats.filtered++;
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
    window.ntmfTimer = setTimeout(() => {
      applyFilterToAll();
      if (deepScanInProgress) {
        // Auto-add new items to current scan
        const listings = document.querySelectorAll('a[href*="/marketplace/item/"]');
        const urlsToAdd = [];
        listings.forEach(link => {
          const container = link.closest('div[style*="max-width"]') || link.parentElement;
          if (container && !container.classList.contains('fb-filter-dimmed') && !container.querySelector('.ntmf-reason-badge')) {
            const url = new URL(link.href);
            url.search = '';
            const cleanUrl = url.href;
            
            const label = link.getAttribute('aria-label') || "";
            const textLines = (container.innerText || "").split('\n');
            const priceLine = textLines.find(line => line.toLowerCase().includes('₫') || line.toLowerCase().includes('$'));
            const existingPrice = extractPrice(priceLine || label);

            urlsToAdd.push({ url: cleanUrl, existingPrice: existingPrice });
            addBadge(container, 'Queued', '#0866ff', 'white');
          }
        });
        if (urlsToAdd.length > 0) {
          chrome.runtime.sendMessage({ action: 'addToDeepScan', urls: urlsToAdd });
        }
      }
    }, 250);
  }
});

const init = () => {
  loadSettings();
  observer.observe(document.body, { childList: true, subtree: true });
  console.log("[FaceDong] Initialized.");
};

if (window.location.search.includes('ntmf_deepscan=1')) {
  loadSettings(true);
} else {
  const waitForDOM = setInterval(() => {
    if (document.querySelector('a[href*="/marketplace/item/"]')) {
      clearInterval(waitForDOM);
      init();
    }
  }, 1000);
}
