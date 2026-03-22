let queue = [];
let activeTabId = null;
let currentUrl = null;
let mainTabId = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startDeepScan') {
    queue = request.urls;
    mainTabId = sender.tab.id;
    processNext();
    sendResponse({ status: 'started' });
  } else if (request.action === 'deepScanResult') {
    if (mainTabId) {
      chrome.tabs.sendMessage(mainTabId, {
        action: 'updateListing',
        url: request.url,
        reason: request.reason
      }).catch(() => {});
    }
    if (activeTabId === sender.tab.id) {
      chrome.tabs.remove(activeTabId);
      activeTabId = null;
    }
    processNext();
  }
});

function processNext() {
  if (queue.length === 0) {
    if (mainTabId) {
      chrome.tabs.sendMessage(mainTabId, { action: 'deepScanComplete' }).catch(() => {});
    }
    return;
  }

  currentUrl = queue.shift();
  if (mainTabId) {
    chrome.tabs.sendMessage(mainTabId, { action: 'deepScanProgress', remaining: queue.length }).catch(() => {});
  }

  chrome.tabs.create({ url: currentUrl, active: false }, (tab) => {
    activeTabId = tab.id;
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId === activeTabId && changeInfo.status === 'complete') {
    // Inject a little delay before scanning to let React render
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { action: 'performDeepScan', url: currentUrl }).catch((err) => {
        // If it fails (e.g., no content script), we close and continue
        chrome.tabs.remove(tabId);
        activeTabId = null;
        processNext();
      });
    }, 2000);
  }
});
