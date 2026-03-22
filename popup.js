document.addEventListener('DOMContentLoaded', () => {
  const elements = {
    enabled: document.getElementById('enabled'),
    minPrice: document.getElementById('minPrice'),
    maxPrice: document.getElementById('maxPrice'),
    excludeKeywords: document.getElementById('excludeKeywords'),
    includeKeywords: document.getElementById('includeKeywords'),
    themeSelect: document.getElementById('themeSelect'),
    saveBtn: document.getElementById('save')
  };

  const applyTheme = (theme) => {
    document.body.classList.remove('theme-light', 'theme-dark');
    if (theme !== 'auto') {
      document.body.classList.add(`theme-${theme}`);
    }
  };

  // Load existing settings
  chrome.storage.sync.get(['settings', 'popupTheme'], (result) => {
    if (result.settings) {
      const s = result.settings;
      elements.enabled.checked = s.enabled;
      elements.minPrice.value = s.minPrice / 1000000;
      elements.maxPrice.value = s.maxPrice / 1000000;
      elements.excludeKeywords.value = s.excludeKeywords.join(', ');
      elements.includeKeywords.value = s.includeKeywords.join(', ');
    }
    
    const theme = result.popupTheme || 'auto';
    elements.themeSelect.value = theme;
    applyTheme(theme);
  });

  // Handle Theme change instantly
  elements.themeSelect.addEventListener('change', (e) => {
    const theme = e.target.value;
    applyTheme(theme);
    chrome.storage.sync.set({ popupTheme: theme });
  });

  // Save settings
  elements.saveBtn.addEventListener('click', () => {
    const settings = {
      enabled: elements.enabled.checked,
      minPrice: (parseFloat(elements.minPrice.value) || 0) * 1000000,
      maxPrice: (parseFloat(elements.maxPrice.value) || 100) * 1000000,
      excludeKeywords: elements.excludeKeywords.value.split(',').map(s => s.trim()).filter(s => s),
      includeKeywords: elements.includeKeywords.value.split(',').map(s => s.trim()).filter(s => s)
    };

    chrome.storage.sync.set({ settings }, () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { action: "updateSettings", settings }).catch(e => {});
        }
      });
      
      elements.saveBtn.textContent = "Saved!";
      setTimeout(() => {
        elements.saveBtn.textContent = "Save & Apply";
      }, 1500);
    });
  });
});
