/**
 * DDoS-Guard Helper Script
 * This script gets injected into pages protected by DDoS-Guard
 * to help automatically complete verification
 */
(function() {
  console.log("[DDoS-Guard Helper] Loaded");
  
  // Function to handle DDoS-Guard hCaptcha verification
  function handleDDoSGuardChallenge() {
    console.log("[DDoS-Guard Helper] Looking for verification elements");
    
    // Check if we're on a DDoS-Guard page
    if (document.title.includes("DDoS-Guard") || 
        document.body.textContent.includes("Checking your browser") ||
        document.body.textContent.includes("bot request")) {
      
      console.log("[DDoS-Guard Helper] Detected DDoS-Guard challenge page");
      
      // 1. Try to click all checkboxes
      document.querySelectorAll('input[type="checkbox"]').forEach(function(checkbox) {
        try {
          console.log("[DDoS-Guard Helper] Clicking checkbox");
          checkbox.click();
        } catch(e) {
          console.error("[DDoS-Guard Helper] Error clicking checkbox:", e);
        }
      });
      
      // 2. Make hCaptcha iframes visible and accessible
      document.querySelectorAll('iframe[src*="hcaptcha"], iframe[src*="captcha"]').forEach(function(iframe) {
        try {
          iframe.style.opacity = "1";
          iframe.style.visibility = "visible";
          iframe.style.display = "block";
          iframe.style.pointerEvents = "auto";
          iframe.style.zIndex = "999999";
          iframe.style.position = "relative";
          iframe.style.transform = "none";
          console.log("[DDoS-Guard Helper] Enhanced captcha iframe visibility");
        } catch(e) {
          console.error("[DDoS-Guard Helper] Error enhancing iframe:", e);
        }
      });
      
      // 3. If hCaptcha is already present, enhance it
      if (window.hcaptcha) {
        console.log("[DDoS-Guard Helper] hCaptcha API detected");
        
        // Override the hCaptcha render method
        const originalRender = window.hcaptcha.render;
        window.hcaptcha.render = function(container, params) {
          console.log("[DDoS-Guard Helper] hCaptcha render called");
          
          // Ensure we have parameters
          params = params || {};
          
          // Add our own callback
          const originalCallback = params.callback;
          params.callback = function(token) {
            console.log("[DDoS-Guard Helper] hCaptcha verification successful");
            
            // Call original callback if it exists
            if (originalCallback) originalCallback(token);
            
            // Wait for processing and then try to submit forms
            setTimeout(function() {
              // Force form submission
              document.querySelectorAll('form').forEach(function(form) {
                try {
                  console.log("[DDoS-Guard Helper] Submitting form after verification");
                  form.submit();
                } catch(e) {
                  console.error("[DDoS-Guard Helper] Error submitting form:", e);
                  // Try event-based submission as fallback
                  try {
                    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                  } catch(e2) {
                    console.error("[DDoS-Guard Helper] Event submission failed:", e2);
                  }
                }
              });
              
              // Try to click buttons as fallback
              document.querySelectorAll('button, input[type="submit"]').forEach(function(button) {
                try {
                  console.log("[DDoS-Guard Helper] Clicking button after verification");
                  button.click();
                } catch(e) {
                  console.error("[DDoS-Guard Helper] Error clicking button:", e);
                }
              });
              
              // Last resort - try to navigate to original URL
              try {
                const urlParams = new URLSearchParams(window.location.search);
                const originalUrl = urlParams.get('url');
                if (originalUrl) {
                  console.log("[DDoS-Guard Helper] Redirecting to original URL:", originalUrl);
                  setTimeout(function() {
                    window.location.href = originalUrl;
                  }, 1000);
                }
              } catch(e) {
                console.error("[DDoS-Guard Helper] Error with URL redirect:", e);
              }
            }, 1500);
          };
          
          // Call original render with our enhanced params
          return originalRender.call(this, container, params);
        };
      }
    }
  }
  
  // Execute when DOM is ready
  if (document.readyState === "complete" || document.readyState === "interactive") {
    handleDDoSGuardChallenge();
  } else {
    document.addEventListener("DOMContentLoaded", handleDDoSGuardChallenge);
  }
  
  // Also run after load (for dynamically loaded content)
  window.addEventListener("load", function() {
    setTimeout(handleDDoSGuardChallenge, 1000);
  });
  
  // Set up a mutation observer to detect when challenge elements are added
  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if (mutation.addedNodes && mutation.addedNodes.length > 0) {
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const node = mutation.addedNodes[i];
          if (node.nodeType === 1) { // Element node
            if (node.tagName === 'IFRAME' || 
                node.id && node.id.includes('captcha') ||
                node.className && node.className.includes('captcha')) {
              console.log("[DDoS-Guard Helper] Detected new captcha element, running helper");
              handleDDoSGuardChallenge();
              break;
            }
          }
        }
      }
    });
  });
  
  // Start observing the document body for added nodes
  observer.observe(document.body, { childList: true, subtree: true });
  
  // Run periodically to catch any issues
  setInterval(handleDDoSGuardChallenge, 5000);
})();
