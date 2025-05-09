// Content script that will be injected into all pages
// This script acts as a bridge between the page context and the extension

// Listen for messages from the service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getRedBlock') {
    // Call the function in the page context
    window.getRedBlock(message.html);
    sendResponse({success: true});
  } else if (message.action === 'getGreenBlock') {
    // Call the function in the page context
    window.getGreenBlock(message.html);
    sendResponse({success: true});
  }
  return true; // Keep the message channel open for async response
});

console.log('Cashback-bot content script loaded');
