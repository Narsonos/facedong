let queue = [];
let activeTabs = new Map(); // tabId -> {url, existingPrice}
let mainTabId = null;
let maxWorkers = 1;
let pendingCount = 0;

// Load initial settings
chrome.storage.sync.get(['settings'], (result) => {
  if (result.settings && result.settings.deepScanWorkers) {
    maxWorkers = result.settings.deepScanWorkers;
  }
});

// Listen for settings changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings && changes.settings.newValue) {
    if (changes.settings.newValue.deepScanWorkers) {
      maxWorkers = changes.settings.newValue.deepScanWorkers;
      processNext();
    }
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startDeepScan') {
    queue = request.urls;
    mainTabId = sender.tab.id;
    processNext();
    sendResponse({ status: 'started' });
  } else if (request.action === 'addToDeepScan') {
    request.urls.forEach(item => {
      if (!queue.find(q => q.url === item.url)) {
        queue.push(item);
      }
    });
    processNext();
    sendResponse({ status: 'added' });
  } else if (request.action === 'deepScanResult') {
    if (mainTabId) {
      chrome.tabs.sendMessage(mainTabId, {
        action: 'updateListing',
        url: request.url,
        reason: request.reason
      }).catch(() => {});
    }
    if (activeTabs.has(sender.tab.id)) {
      chrome.tabs.remove(sender.tab.id);
      activeTabs.delete(sender.tab.id);
    }
    processNext();
  }
});

function processNext() {
  if (queue.length === 0 && activeTabs.size === 0 && pendingCount === 0) {
    if (mainTabId) {
      chrome.tabs.sendMessage(mainTabId, { action: 'deepScanComplete' }).catch(() => {});
    }
    return;
  }

  while ((activeTabs.size + pendingCount) < maxWorkers && queue.length > 0) {
    const item = queue.shift();
    pendingCount++;
    
    if (mainTabId) {
      chrome.tabs.sendMessage(mainTabId, { action: 'deepScanProgress', remaining: queue.length + activeTabs.size + pendingCount }).catch(() => {});
      chrome.tabs.sendMessage(mainTabId, { action: 'deepScanStatus', url: item.url, status: 'Scanning...' }).catch(() => {});
    }

    const targetUrl = new URL(item.url);
    targetUrl.searchParams.set('ntmf_deepscan', '1');
    chrome.tabs.create({ url: targetUrl.href, active: false }, (tab) => {
      pendingCount--;
      activeTabs.set(tab.id, item);
      // Ensure we check for next items as current slots are now accurately tracked in activeTabs
      processNext();
    });
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (activeTabs.has(tabId) && changeInfo.status === 'complete') {
    const item = activeTabs.get(tabId);
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { 
        action: 'performDeepScan', 
        url: item.url, 
        existingPrice: item.existingPrice 
      }).catch((err) => {
        chrome.tabs.remove(tabId);
        activeTabs.delete(tabId);
        processNext();
      });
    }, 200);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTabs.has(tabId)) {
    activeTabs.delete(tabId);
    processNext();
  }
});
