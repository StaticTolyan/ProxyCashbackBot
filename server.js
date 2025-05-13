const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const iconv = require('iconv-lite');
const { URL } = require('url');
const session = require('express-session');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Add cookie and session support
app.use(cookieParser());
app.use(session({
  secret: 'proxy-cashback-bot-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

const CASHBACK_DOMAIN = 'https://cashback-bot.com';
const CASHBACK_API_DOMAIN = 'https://cashback-bot.com/v1';

// Helper to modify HTML links
function rewriteLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  // Remove <base> tags so original domain doesn’t override proxy links
  $('base').remove();
  // Remove restrictive meta tags (e.g., Content-Security-Policy)
  $('meta[http-equiv]').remove();
  // Ensure mobile viewport is present
  $('meta[name="viewport"]').remove();
  $('head').prepend('<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">');
  // Inject proxying for dynamic fetch and XHR with CAPTCHA handling
  $('head').prepend(`<script>
    (function(){
      // Enhanced CAPTCHA and protection service URL detection
      var isCaptchaUrl = function(url) {
        return (
          url.includes('recaptcha') || 
          url.includes('hcaptcha.com') || 
          url.includes('challenges.cloudflare.com') ||
          url.includes('captcha') ||
          url.includes('arkoselabs') ||
          url.includes('funcaptcha') ||
          url.includes('ddos-guard') ||
          url.includes('shield.') ||
          url.includes('check.') ||
          url.includes('bot-protection') ||
          url.includes('cf-') ||
          url.includes('captcha-delivery') ||
          url.includes('cf_chl_') ||
          url.includes('kasada') ||
          url.includes('challenge')
        );
      };
      
      // Special handling for CAPTCHA verification URLs
      var isVerificationUrl = function(url) {
        return (
          url.includes('verify') ||
          url.includes('siteverify') ||
          url.includes('callback') ||
          url.includes('api/v1') ||
          url.includes('api2/anchor') ||
          url.includes('enterprise/anchor')
        );
      };
      
      // Save original window.postMessage
      var originalPostMessage = window.postMessage;
      // Override postMessage to ensure CAPTCHA frames can communicate
      window.postMessage = function(message, targetOrigin, transfer) {
        // Allow all CAPTCHA-related postMessage calls
        return originalPostMessage.apply(this, arguments);
      };
      
      // Save original functions
      var originalFetch = window.fetch;
      var originalOpen = XMLHttpRequest.prototype.open;
      var originalSend = XMLHttpRequest.prototype.send;
      
      // Override fetch
      window.fetch = function(resource, init) {
        var url = (typeof resource === "string") ? resource : resource.url;
        
        // Special handling for CAPTCHA verification
        if (isCaptchaUrl(url) || isVerificationUrl(url)) {
          console.log("Direct fetch to CAPTCHA URL:", url);
          return originalFetch.call(this, resource, init)
            .then(function(response) {
              // Store successful verification for debugging
              if (url.includes('verify') || url.includes('siteverify')) {
                console.log("CAPTCHA verification completed");
              }
              return response;
            });
        }
        
        // Proxy other requests
        return originalFetch.call(this, "/proxy?url=" + encodeURIComponent(url), init);
      };
      
      // Override XHR open
      XMLHttpRequest.prototype.open = function(method, url) {
        // Store original URL for verification checks
        this._originalUrl = url;
        
        // Let CAPTCHA requests go through directly
        if (isCaptchaUrl(url) || isVerificationUrl(url)) {
          console.log("Direct XHR to CAPTCHA URL:", url);
          return originalOpen.apply(this, arguments);
        }
        
        // Proxy other requests
        arguments[1] = "/proxy?url=" + encodeURIComponent(url);
        var originalSend = XMLHttpRequest.prototype.send;
      
      // Override XHR send to track verification responses
      XMLHttpRequest.prototype.send = function(body) {
        var xhr = this;
        
        // If this is a verification request, monitor its completion
        if (xhr._originalUrl && (xhr._originalUrl.includes('verify') || xhr._originalUrl.includes('siteverify'))) {
          var originalOnLoad = xhr.onload;
          xhr.onload = function() {
            console.log("CAPTCHA verification XHR completed");
            
            // For DDoS-Guard specifically, try to handle the response
            if (xhr._originalUrl.includes('ddos') || 
                xhr._originalUrl.includes('guard') || 
                xhr._originalUrl.includes('captcha') || 
                document.title.includes('DDoS')) {
              console.log('DDoS-Guard verification completed, checking response');
              
              try {
                // Try to parse the response if it's JSON
                var responseData = JSON.parse(xhr.responseText);
                console.log('Verification response:', responseData);
                
                // If we have a success or token field, try to handle it
                if (responseData.success || responseData.token || responseData.pass) {
                  console.log('Verification successful, attempting page navigation');
                  
                  // Try to submit forms or click continue buttons
                  setTimeout(function() {
                    // Submit any forms with captcha fields
                    document.querySelectorAll('form input[name^="h-captcha"], form input[name^="g-recaptcha"], form input[name="captcha"]').forEach(function(input) {
                      var form = input.closest('form');
                      if (form) {
                        console.log('Submitting form after verification');
                        form.submit();
                      }
                    });
                    
                    // Click any visible submit buttons
                    document.querySelectorAll('button[type="submit"], input[type="submit"], button.submit-button, button.continue, button.proceed').forEach(function(button) {
                      console.log('Clicking submit button after verification');
                      button.click();
                    });
                  }, 500);
                }
              } catch (e) {
                console.error('Error handling verification response:', e);
              }
            }
            
            if (originalOnLoad) originalOnLoad.apply(this, arguments);
          };
        }
        
        // Continue with original send
        return originalSend.apply(this, arguments);
      };
      
      // Hook into CAPTCHA and protection service callbacks
      window.addEventListener('DOMContentLoaded', function() {
        // Helper for finding and clicking buttons
        var tryClickButton = function(selectors) {
          for (var i = 0; i < selectors.length; i++) {
            var elements = document.querySelectorAll(selectors[i]);
            for (var j = 0; j < elements.length; j++) {
              try {
                console.log('Attempting to click:', selectors[i]);
                elements[j].click();
                return true;
              } catch (e) {
                console.error('Click failed:', e);
              }
            }
          }
          return false;
        };

        // Handle DDoS-Guard and other protection services
        var handleProtectionServices = function() {
          console.log('Handling protection services...');
          
          // Check for DDoS-Guard specifically (the one in the screenshot)
          var isDDoSGuard = document.title.includes('DDoS-Guard') || 
                            document.body.textContent.includes('Checking your browser') ||
                            document.body.textContent.includes('bot request');
                            
          if (isDDoSGuard) {
            console.log('DDoS-Guard detected, attempting specialized handling');
            
            // Look for hCaptcha iframe and interact with it
            var captchaIframes = document.querySelectorAll('iframe[src*="hcaptcha"], iframe[src*="captcha"], iframe[data-hcaptcha-widget-id]');
            if (captchaIframes.length > 0) {
              console.log('Found hCaptcha iframe:', captchaIframes.length);
              
              // Try to make hCaptcha iframe more accessible
              captchaIframes.forEach(function(iframe) {
                try {
                  // Set iframe styles to make it more visible
                  iframe.style.opacity = '1';
                  iframe.style.pointerEvents = 'auto';
                  iframe.style.display = 'block';
                  iframe.style.visibility = 'visible';
                  iframe.style.zIndex = '9999';
                  
                  // Attempt to focus the iframe
                  iframe.focus();
                  console.log('Focused hCaptcha iframe');
                } catch (e) {
                  console.error('Error focusing iframe:', e);
                }
              });
            }

            // Handle DDoS-Guard specific buttons and checkboxes
            setTimeout(function() {
              // Try clicking specifically on DDoS-Guard elements
              var ddosElements = document.querySelectorAll('.ddos-guard-captcha, .ddos-guard-checkbox, .challenge-form button, input[type="checkbox"]');
              ddosElements.forEach(function(el) {
                try {
                  console.log('Clicking DDoS-Guard element:', el.tagName);
                  el.click();
                } catch (e) {
                  console.error('Error clicking element:', e);
                }
              });
              
              // Try to check all checkboxes (common in DDoS-Guard)
              var checkboxes = document.querySelectorAll('input[type="checkbox"]');
              checkboxes.forEach(function(checkbox) {
                try {
                  if (!checkbox.checked) {
                    checkbox.checked = true;
                    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                    checkbox.dispatchEvent(new Event('click', { bubbles: true }));
                    console.log('Checked a checkbox');
                  }
                } catch (e) {
                  console.error('Error with checkbox:', e);
                }
              });
              
              // Find and submit the form if present
              var forms = document.querySelectorAll('form');
              forms.forEach(function(form) {
                try {
                  console.log('Submitting DDoS-Guard form');
                  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                } catch (e) {
                  console.error('Form submission error:', e);
                }
              });
            }, 2000);
          }
          
          // Common button selectors for various protection services
          var buttonSelectors = [
            '.ddos-guard-checkbox', // DDoS-Guard checkbox
            '.h-captcha-checkbox', // hCaptcha checkbox
            '.h-captcha', // hCaptcha elements
            '.h-captcha-response-button', // hCaptcha response button
            '.captcha-solver', // Generic captcha solver
            '.captcha-checkbox', // Common captcha checkbox
            '#checkbox', // Common checkbox id
            '.checkbox', // Common checkbox class
            '.btn-success', // Common success button
            '#btn-primary', // Primary button
            '.btn[type="submit"]', // Submit buttons
            'button.g-recaptcha', // reCAPTCHA button
            'button:not([disabled])', // Any non-disabled button
            'input[type="submit"]:not([disabled])', // Any non-disabled submit
            'input.g-recaptcha', // reCAPTCHA input
            'a.btn-success', // Success link-button
            '.button-wrapper button', // Buttons in wrappers
            '.protection-button', // Protection buttons
            '.proceed-button', // Proceed buttons
            'button:contains("Continue")', // Continue buttons
            'button:contains("Proceed")', // Proceed buttons
            'button:contains("Verify")', // Verify buttons
            '#challenge-stage button', // Challenge stage buttons
            '#challenge-form button', // Challenge form buttons
            'button', // Any button as last resort
            'input[type="submit"]' // Any submit as last resort
          ];
          
          // Try clicking appropriate buttons
          if (tryClickButton(buttonSelectors)) {
            console.log('Protection service button clicked!');
          }
          
          // Handle checkbox-based verification
          var checkboxes = document.querySelectorAll('input[type="checkbox"]');
          for (var i = 0; i < checkboxes.length; i++) {
            try {
              if (!checkboxes[i].checked) {
                console.log('Checking checkbox for verification');
                checkboxes[i].checked = true;
                checkboxes[i].dispatchEvent(new Event('change', { bubbles: true }));
                checkboxes[i].dispatchEvent(new Event('click', { bubbles: true }));
              }
            } catch (e) {
              console.error('Checkbox interaction failed:', e);
            }
          }

          // Try to find and submit forms
          var forms = document.querySelectorAll('form');
          for (var i = 0; i < forms.length; i++) {
            // Skip search forms and other common non-verification forms
            if (forms[i].id === 'search-form' || forms[i].className.includes('search') || forms[i].action.includes('search')) {
              continue;
            }
            
            try {
              console.log('Attempting to submit protection form');
              forms[i].dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            } catch (e) {
              console.error('Form submission failed:', e);
            }
          }
        };
        
        // Run protection service handler after a short delay
        setTimeout(handleProtectionServices, 1500);
        // And also run it periodically in case new elements appear
        setInterval(handleProtectionServices, 5000);
        
        // Specifically handle hCaptcha in DDoS-Guard context
        window.addEventListener('load', function() {
          console.log('Window loaded, looking for captchas');
          
          // Wait a bit for dynamic content
          setTimeout(function() {
            // Direct attempt to handle hCaptcha in DDoS-Guard
            if (document.title.includes('DDoS-Guard') || document.body.textContent.includes('bot request')) {
              console.log('DDoS-Guard detected on page load');
              
              // Find and click all checkboxes (common first step)
              document.querySelectorAll('input[type="checkbox"]').forEach(function(checkbox) {
                try {
                  console.log('Found checkbox, clicking it');
                  checkbox.click();
                } catch (e) {}
              });
              
              // Check if we have hCaptcha
              if (window.hcaptcha) {
                console.log('hCaptcha found in DDoS-Guard context');
                try {
                  // Attempt to execute hCaptcha
                  var captchaContainers = document.querySelectorAll('[data-sitekey], [data-hcaptcha-sitekey], .h-captcha');
                  captchaContainers.forEach(function(container) {
                    console.log('Found hCaptcha container, rendering');
                    // Render if not already rendered
                    var widgetId = container.getAttribute('data-hcaptcha-widget-id');
                    if (!widgetId && window.hcaptcha && window.hcaptcha.render) {
                      var sitekey = container.getAttribute('data-sitekey') || container.getAttribute('data-hcaptcha-sitekey');
                      if (sitekey) {
                        console.log('Rendering hCaptcha with sitekey:', sitekey);
                        window.hcaptcha.render(container, {
                          sitekey: sitekey,
                          callback: function(token) {
                            console.log('hCaptcha solved in DDoS-Guard context');
                            // Submit the form after solving
                            setTimeout(function() {
                              var form = container.closest('form');
                              if (form) {
                                form.submit();
                                console.log('Form submitted after hCaptcha');
                              }
                            }, 500);
                          }
                        });
                      }
                    }
                  });
                } catch (e) {
                  console.error('Error handling hCaptcha:', e);
                }
              }
            }
          }, 2000);
        });

        // Check for hCaptcha scripts and setup callback handler
        setTimeout(function() {
          if (window.hcaptcha) {
            console.log("hCaptcha detected, setting up hooks");
            var originalRender = window.hcaptcha.render;
            window.hcaptcha.render = function(container, params) {
              console.log('hCaptcha render called with params:', JSON.stringify(params));
              
              // Handle DDoS-Guard specific case
              var isDDoSGuard = document.title.includes('DDoS-Guard') || 
                                document.body.textContent.includes('Checking your browser') ||
                                document.body.textContent.includes('bot request');
                                
              if (isDDoSGuard) {
                console.log('Enhancing hCaptcha for DDoS-Guard');
                // Make sure we have a callback for DDoS-Guard
                if (!params) params = {};
                if (!params.callback) {
                  params.callback = function(token) {
                    console.log('DDoS-Guard hCaptcha verification successful:', token.substring(0,10) + '...');
                    // Try to submit the form or click buttons after verification
                    setTimeout(function() {
                      // Find all forms and try to submit them
                      document.querySelectorAll('form').forEach(function(form) {
                        console.log('Submitting form after DDoS-Guard verification');
                        try { form.submit(); } catch(e) { console.error(e); }
                      });
                    }, 1000);
                  };
                }
              }
              
              // Ensure callback works for all hCaptcha instances
              var originalCallback = params && params.callback;
              if (originalCallback) {
                params.callback = function(token) {
                  console.log("hCaptcha verification successful", token.substring(0,10) + "...");
                  // Trigger form submission after successful verification
                  setTimeout(function() {
                    if (originalCallback) originalCallback(token);
                    // Find the form containing the hCaptcha element and submit it using direct submit
                    var containerEl = typeof container === 'string' ? document.getElementById(container) : container;
                    if (containerEl) {
                      var form = containerEl.closest('form');
                      if (form) {
                        console.log("Submitting form after hCaptcha verification");
                        try {
                          // Try both submit methods
                          form.submit();
                          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                        } catch(e) { console.error(e); }
                      }
                    }
                    
                    // If we're in DDoS-Guard context, try to find and click buttons too
                    if (isDDoSGuard) {
                      document.querySelectorAll('button, input[type="submit"]').forEach(function(btn) {
                        try { btn.click(); } catch(e) {}
                      });
                    }
                  }, 500);
                };
              }
              return originalRender.apply(this, arguments);
          }
          
          // Handle reCAPTCHA if present
          if (window.grecaptcha) {
            console.log("reCAPTCHA detected, setting up hooks");
            if (window.grecaptcha.enterprise) {
              var originalEnterpriseRender = window.grecaptcha.enterprise.render;
              window.grecaptcha.enterprise.render = function(container, params) {
                // Add callback handling similar to hCaptcha
                if (params && params.callback) {
                  var originalCallback = params.callback;
                  params.callback = function(token) {
                    console.log("reCAPTCHA enterprise verification successful");
                    if (originalCallback) originalCallback(token);
                    setTimeout(handleProtectionServices, 1000);
                  };
                }
                return originalEnterpriseRender.apply(this, arguments);
              };
            } else {
              var originalRecaptchaRender = window.grecaptcha.render;
              window.grecaptcha.render = function(container, params) {
                if (params && params.callback) {
                  var originalCallback = params.callback;
                  params.callback = function(token) {
                    console.log("reCAPTCHA verification successful");
                    if (originalCallback) originalCallback(token);
                    setTimeout(handleProtectionServices, 1000);
                  };
                }
                return originalRecaptchaRender.apply(this, arguments);
              };
            }
          }
        }, 1000);

        // Monitor DOM changes to detect new protection elements
        if (window.MutationObserver) {
          var observer = new MutationObserver(function(mutations) {
            var shouldCheck = false;
            
            mutations.forEach(function(mutation) {
              // Check for added nodes that might be protection-related
              if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                for (var i = 0; i < mutation.addedNodes.length; i++) {
                  var node = mutation.addedNodes[i];
                  if (node.nodeType === 1) { // Element node
                    if (
                      node.id && (
                        node.id.includes('captcha') || 
                        node.id.includes('challenge') || 
                        node.id.includes('protection') ||
                        node.id.includes('guard')
                      ) ||
                      node.className && (
                        node.className.includes('captcha') ||
                        node.className.includes('challenge') ||
                        node.className.includes('protection') ||
                        node.className.includes('guard')
                      )
                    ) {
                      shouldCheck = true;
                      break;
                    }
                  }
                }
              }
            });
            
            if (shouldCheck) {
              setTimeout(handleProtectionServices, 500);
            }
          });
          
          observer.observe(document.body, {
            childList: true,
            subtree: true
          });
        }
      });
    })();
  </script>`);
  // Preserve CAPTCHA and protection scripts
  $('script').each((_, el) => {
    const $script = $(el);
    const src = $script.attr('src');
    const html = $script.html();
    
    // Don't modify inline scripts for CAPTCHAs or protection services
    if (html && (
        html.includes('recaptcha') || 
        html.includes('hcaptcha') || 
        html.includes('captcha') ||
        html.includes('challenges.cloudflare') ||
        html.includes('ddos-guard') ||
        html.includes('challenge') ||
        html.includes('cf.') ||
        html.includes('security') ||
        html.includes('bot') ||
        html.includes('protection') ||
        html.includes('shield') ||
        html.includes('guard') ||
        html.includes('kasada')
      )) {
      // Mark this script to be preserved
      $script.attr('data-preserve-protection', 'true');
    }
    
    // Don't modify script src for CAPTCHA and protection services
    if (src && (
        src.includes('recaptcha') || 
        src.includes('hcaptcha.com') || 
        src.includes('challenges.cloudflare.com') ||
        src.includes('captcha') ||
        src.includes('ddos-guard') ||
        src.includes('shield.') ||
        src.includes('challenge') ||
        src.includes('cf.') ||
        src.includes('security') ||
        src.includes('cloudflare') ||
        src.includes('bot-protection') ||
        src.includes('captcha-delivery') ||
        src.includes('kasada')
      )) {
      // Keep the original src
      $script.attr('data-original-src', src);
      $script.removeAttr('src'); // Will be restored later
    }
  });
  
  // Add helper script for browser fingerprinting
  $('head').append(`<script>
    // Override some browser fingerprinting methods to appear more like a real browser
    (function() {
      // Navigator properties that are commonly checked
      try {
        const pluginsLength = Math.floor(Math.random() * 3) + 3; // Random between 3-5 plugins
        Object.defineProperty(navigator, 'plugins', {
          get: function() {
            return { length: pluginsLength };
          }
        });
        
        // Make webdriver property not detectable
        Object.defineProperty(navigator, 'webdriver', {
          get: function() { return false; }
        });
        
        // Add dummy language preferences
        Object.defineProperty(navigator, 'languages', {
          get: function() { return ['en-US', 'en', 'es']; }
        });
      } catch (e) {
        console.error('Error overriding navigator properties:', e);
      }

      // Some protection services check if certain functions are native
      try {
        const nativeToString = Function.prototype.toString;
        Function.prototype.toString = function() {
          if (this === Function.prototype.toString) {
            return nativeToString.call(nativeToString);
          }
          // Make all functions appear native
          if (this.name === 'detect' || 
              this.name.includes('check') || 
              this.name.includes('bot') || 
              this.name.includes('protection')) {
            return 'function ' + this.name + '() { [native code] }';
          }
          return nativeToString.call(this);
        };
      } catch (e) {
        console.error('Error overriding Function.prototype.toString:', e);
      }
      
      // Simulate proper mouse movements for bot detection
      if (!window._mouseMovementSimulated) {
        window._mouseMovementSimulated = true;
        
        // Create random mouse movements to appear human
        const simulateMouseMovement = function() {
          const events = [];
          const numMovements = 5 + Math.floor(Math.random() * 10);
          
          // Create random start position
          let x = Math.floor(Math.random() * window.innerWidth);
          let y = Math.floor(Math.random() * window.innerHeight);
          
          // Generate random smooth movement path
          for (let i = 0; i < numMovements; i++) {
            // Target position with some randomness
            const targetX = Math.floor(Math.random() * window.innerWidth);
            const targetY = Math.floor(Math.random() * window.innerHeight);
            
            // Number of steps to reach target (for smooth movement)
            const steps = 5 + Math.floor(Math.random() * 10);
            
            // Calculate increments
            const incX = (targetX - x) / steps;
            const incY = (targetY - y) / steps;
            
            // Create movement steps
            for (let step = 0; step < steps; step++) {
              // Add slight randomness to each step
              x += incX + (Math.random() * 2 - 1);
              y += incY + (Math.random() * 2 - 1);
              
              events.push({ type: 'mousemove', x: Math.round(x), y: Math.round(y), when: step * 50 });
            }
          }
          
          // Dispatch events with realistic timing
          events.forEach(function(event) {
            setTimeout(function() {
              const mouseEvent = new MouseEvent(event.type, {
                view: window,
                bubbles: true,
                cancelable: true,
                clientX: event.x,
                clientY: event.y
              });
              document.dispatchEvent(mouseEvent);
            }, event.when);
          });
        };
        
        // Run initial simulation and then periodically
        setTimeout(simulateMouseMovement, 1000);
        setInterval(simulateMouseMovement, 30000); // Every 30 seconds
      }
    })();
  </script>`);
  
  // Rewrite inline <style> tags
  $('style').each((_, el) => {
    let css = $(el).html();
    css = css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g, (match, quote, u) => {
      if (u.startsWith('data:')) return match;
      try {
        const abs = new URL(u, baseUrl).href;
        return `url(${quote}/proxy?url=${encodeURIComponent(abs)}${quote})`;
      } catch {
        return match;
      }
    });
    $(el).html(css);
  });
  // Rewrite inline style attributes
  $('[style]').each((_, el) => {
    let styleVal = $(el).attr('style');
    styleVal = styleVal.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g, (match, quote, u) => {
      if (u.startsWith('data:')) return match;
      try {
        const abs = new URL(u, baseUrl).href;
        return `url(${quote}/proxy?url=${encodeURIComponent(abs)}${quote})`;
      } catch {
        return match;
      }
    });
    $(el).attr('style', styleVal);
  });
  // Rewrite forms: submit through proxy preserving original action URL
  $('form[action]').each((_, el) => {
    const $form = $(el);
    const actionVal = $form.attr('action');
    if (!actionVal || actionVal.startsWith('javascript:') || actionVal.startsWith('mailto:') || actionVal.startsWith('#')) return;
    let absAction;
    try { absAction = new URL(actionVal, baseUrl).href; } catch { return; }
    // set form to proxy endpoint
    $form.attr('action', '/proxy');
    // ensure url field targets original action
    $form.find('input[name="url"]').remove();
    $form.prepend(`<input type="hidden" name="url" value="${absAction}"/>`);
  });
  const elements = [
    { selector: 'img[srcset]', attr: 'srcset' },
    { selector: 'source[srcset]', attr: 'srcset' },
    { selector: 'a[href]', attr: 'href' },
    { selector: 'img[src]', attr: 'src' },
    { selector: 'video[src]', attr: 'src' },
    { selector: 'audio[src]', attr: 'src' },
    { selector: 'source[src]', attr: 'src' },
    { selector: 'script[src]:not([data-original-src])', attr: 'src' },  // Skip already processed CAPTCHA scripts
    { selector: 'link[href]', attr: 'href' },
    { selector: 'iframe[src]', attr: 'src' }
  ];
  elements.forEach(({ selector, attr }) => {
    $(selector).each((_, el) => {
      const val = $(el).attr(attr);
      if (!val) return;
      if (attr !== 'srcset' && (val.startsWith('javascript:') || val.startsWith('mailto:') || val.startsWith('#'))) return;
      if (attr === 'srcset') {
        const parts = val.split(',').map(part => {
          const [u, descriptor] = part.trim().split(/\s+/, 2);
          if (u.startsWith('data:')) return part.trim();
          try {
            const abs = new URL(u, baseUrl).href;
            const p = `/proxy?url=${encodeURIComponent(abs)}`;
            return descriptor ? `${p} ${descriptor}` : p;
          } catch {
            return part.trim();
          }
        });
        $(el).attr(attr, parts.join(', '));
        return;
      }
      let absUrl;
      try { absUrl = new URL(val, baseUrl).href; } catch { return; }
      const proxyUrl = `/proxy?url=${encodeURIComponent(absUrl)}`;
      $(el).attr(attr, proxyUrl);
    });
  });
  // Restore CAPTCHA script sources
  $('script[data-original-src]').each((_, el) => {
    const $script = $(el);
    $script.attr('src', $script.attr('data-original-src'));
    $script.removeAttr('data-original-src');
  });
  
  return $.html();
}

// Proxy endpoint
app.get('/proxy', async (req, res) => {
  let targetUrl;
  if (req.query.url) {
    // preserve original action and include other query params
    const rawUrl = req.query.url;
    let decoded = decodeURIComponent(rawUrl);
    // handle protocol-relative URLs
    if (decoded.startsWith('//')) decoded = 'https:' + decoded;
    const urlObj = new URL(decoded);
    Object.entries(req.query).forEach(([key, val]) => {
      if (key === 'url') return;
      urlObj.searchParams.append(key, val);
    });
    targetUrl = urlObj.href;
  } else if ('q' in req.query) {
    // fallback for Google search submissions without url
    const params = new URLSearchParams(req.query).toString();
    targetUrl = `https://www.google.com/search?${params}`;
  } else {
    return res.status(400).send('Missing url parameter');
  }
  // Google I’m Feeling Lucky: catch redirect and proxy final target
  try {
    const luckyTest = new URL(targetUrl);
    if (luckyTest.hostname.includes('google.com') && luckyTest.pathname === '/search' && luckyTest.searchParams.has('btnI')) {
      const luckyRes = await axios.get(targetUrl, { maxRedirects: 0, validateStatus: status => status < 400 });
      if (luckyRes.status >= 300 && luckyRes.status < 400) {
        const loc = luckyRes.headers.location;
        if (loc) {
          const finalUrl = new URL(loc, targetUrl).href;
          return res.redirect(`/proxy?url=${encodeURIComponent(finalUrl)}`);
        }
      }
    }
  } catch (err) {
    console.error('Lucky redirect error:', err.message);
  }
  // Cashback redirect: auto-activate cashback and redirect
  try {
    const cbRes = await axios.get(`${CASHBACK_API_DOMAIN}/shop/check`, { params: { url: targetUrl } });
    if (cbRes.data && cbRes.data.data && typeof cbRes.data.data.go_link !== 'undefined' && cbRes.data.isAuth) {
      const shopId = cbRes.data.data.id;
      const redirectUrl = `${CASHBACK_DOMAIN}/shop/go?id=${shopId}&url=${encodeURIComponent(targetUrl)}`;
      console.log('Cashback redirect to', redirectUrl);
      return res.redirect(redirectUrl);
    }
  } catch (err) {
    console.error('Cashback check error:', err.message);
  }
  try {
    // For DDoS-Guard issues, make sure we have a proper session
    if (!req.session.ddosAttempts) {
      req.session.ddosAttempts = {};
    }
    
    // Track attempts to access this URL (for DDoS-Guard retry logic)
    const urlKey = targetUrl.replace(/https?:\/\//, '').split('/')[0]; // Just get the domain part
    if (!req.session.ddosAttempts[urlKey]) {
      req.session.ddosAttempts[urlKey] = { count: 0, timestamp: Date.now() };
    }
    
    // Build axios options, mimic browser, and accept up to 4xx status for proxying
    // Check if the URL is for a CAPTCHA or protection service
    const isCaptchaUrl = targetUrl.includes('recaptcha') || 
                        targetUrl.includes('hcaptcha.com') || 
                        targetUrl.includes('challenges.cloudflare.com') ||
                        targetUrl.includes('captcha') ||
                        targetUrl.includes('arkoselabs') ||
                        targetUrl.includes('funcaptcha') ||
                        targetUrl.includes('verify') ||
                        targetUrl.includes('siteverify') ||
                        targetUrl.includes('anchor') ||
                        targetUrl.includes('ddos-guard') ||
                        targetUrl.includes('shield.') ||
                        targetUrl.includes('check.') ||
                        targetUrl.includes('bot-protection') ||
                        targetUrl.includes('challenge') ||
                        targetUrl.includes('cf-') ||
                        targetUrl.includes('captcha-delivery') ||
                        targetUrl.includes('cf_chl_') ||
                        targetUrl.includes('kasada');
    
    // Use a more complete desktop browser UA for CAPTCHA services
    const userAgent = isCaptchaUrl ? 
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' :
      'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1';
    
    const axiosOpts = {
      responseType: 'arraybuffer',
      validateStatus: status => status < 500,
      headers: {
        'User-Agent': userAgent,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Dest': 'document',
        'Sec-GPC': '1',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
        'Connection': 'keep-alive',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Pragma': 'no-cache',
        // Add more realistic browser header
        'sec-ch-ua': '"Google Chrome";v="113", "Chromium";v="113", "Not-A.Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"'
      },
      // Enable cookies for protection services
      withCredentials: true,
      // Enable gzip/deflate decompression
      decompress: true,
      // Support redirects
      maxRedirects: 5,
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    };
    
    // Use cookies from previous requests if available
    if (req.session && req.session.cookies && req.session.cookies[targetUrl]) {
      axiosOpts.headers.Cookie = req.session.cookies[targetUrl];
    }
    
    // Add Referer for CAPTCHA requests to help with verification
    if (isCaptchaUrl && req.headers.referer) {
      axiosOpts.headers['Referer'] = req.headers.referer;
    } else if (req.headers.referer) {
      // Try to parse the referer to see if it's a proxy request
      try {
        const refererUrl = new URL(req.headers.referer);
        const urlParam = refererUrl.searchParams.get('url');
        if (urlParam) {
          axiosOpts.headers['Referer'] = urlParam;
        }
      } catch (e) {
        // Invalid referer, ignore
      }
    }
    const response = await axios.get(targetUrl, axiosOpts);
    const contentType = (response.headers['content-type'] || '').toLowerCase();

    if (contentType.includes('text/html')) {
      const buffer = Buffer.from(response.data);
      let charset = 'utf8';
      const headerMatch = /charset=([^;]+)/i.exec(contentType);
      if (headerMatch) {
        charset = headerMatch[1].toLowerCase();
      } else {
        const snippet = buffer.slice(0, 1024).toString('ascii');
        const metaMatch = /<meta[^>]+charset=["']?([^"'>\s]+)/i.exec(snippet)
          || /<meta[^>]+content=["'][^"']*charset=([^"'>\s]+)/i.exec(snippet);
        if (metaMatch) charset = metaMatch[1].toLowerCase();
      }
      const html = iconv.decode(buffer, charset);
      
      // Check if this is a DDoS-Guard page
      const isDDoSGuardPage = html.includes('DDoS-Guard') ||
                            html.includes('Checking your browser before accessing') ||
                            html.includes('Sorry, but this looks too much like a bot request');
      
      // If it's a DDoS-Guard page, increment our counter and inject special helper
      if (isDDoSGuardPage) {
        console.log('DDoS-Guard protection detected for URL:', targetUrl);
        
        // Track this attempt
        req.session.ddosAttempts[urlKey].count++;
        req.session.ddosAttempts[urlKey].timestamp = Date.now();
        
        // Read our special DDoS-Guard helper script
        const fs = require('fs');
        const ddosHelperPath = __dirname + '/ddos-guard-helper.js';
        let ddosHelper = '';
        
        try {
          ddosHelper = fs.readFileSync(ddosHelperPath, 'utf8');
        } catch (err) {
          console.error('Error reading DDoS-Guard helper script:', err);
        }
        
        // Create a special enhanced version of the HTML with our helper
        const $ = cheerio.load(html);
        
        // Add our DDoS-Guard helper script to make CAPTCHA verification work better
        $('head').append(`<script>${ddosHelper}</script>`);
        
        // Make the CAPTCHA more visible and interactive
        $('style').append(`
          iframe[src*="hcaptcha"], iframe[src*="captcha"], iframe[data-hcaptcha-widget-id] {
            opacity: 1 !important;
            visibility: visible !important;
            display: block !important;
            pointer-events: auto !important;
            z-index: 999999 !important;
            position: relative !important;
            transform: none !important;
          }
          input[type="checkbox"] {
            opacity: 1 !important;
            visibility: visible !important;
            display: block !important;
            pointer-events: auto !important;
          }
        `);
        
        // Process the HTML with our standard rewriter
        const modifiedHtml = rewriteLinks($.html(), targetUrl);
        res.set('content-type', contentType);
        return res.send(modifiedHtml);
      }
      
      // Standard processing for non-DDoS-Guard pages
      const modifiedHtml = rewriteLinks(html, targetUrl);
      res.set('content-type', contentType);
      return res.send(modifiedHtml);
    } else if (contentType.includes('text/css')) {
      const buffer = Buffer.from(response.data);
      let charset = 'utf8';
      const headerCss = /charset=([^;]+)/i.exec(contentType);
      if (headerCss) {
        charset = headerCss[1].toLowerCase();
      } else {
        const snippetCss = buffer.slice(0, 1024).toString('ascii');
        const cssMatch = /@charset\s+"([^"]+)"/i.exec(snippetCss);
        if (cssMatch) charset = cssMatch[1].toLowerCase();
      }
      let css = iconv.decode(buffer, charset);
      css = css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g, (match, quote, u) => {
        if (u.startsWith('data:')) return match;
        try {
          const abs = new URL(u, targetUrl).href;
          return `url(${quote}/proxy?url=${encodeURIComponent(abs)}${quote})`;
        } catch {
          return match;
        }
      });
      res.set('content-type', contentType);
      return res.send(css);
    }

    // For non-HTML content, pipe directly
    res.set('content-type', contentType);
    res.send(response.data);
  } catch (error) {
    if (error.response) {
      console.error('Proxy error:', error.response.status, error.response.data);
      const status = error.response.status;
      const contentType = error.response.headers['content-type'] || 'text/plain';
      res.set('content-type', contentType);
      res.status(status).send(error.response.data);
    } else {
      console.error('Proxy error:', error.message);
      res.status(500).send('Proxy error');
    }
  }
});

// Search endpoint
// Root - handles both homepage and search
app.get('/', async (req, res) => {
  const { q } = req.query;
  let resultsHtml = '';
  
  // If search query exists, fetch and process search results
  if (q) {
    try {
      const ddgRes = await axios.get('https://duckduckgo.com/html/', { params: { q } });
      const html = ddgRes.data;
      const $ = cheerio.load(html);
      const results = [];
      
      $('a.result__a').each((i, el) => {
        const $el = $(el);
        const title = $el.text().trim();
        let href = $el.attr('href');
        if (!href) return;
        
        try {
          const parsed = new URL(href, 'https://duckduckgo.com');
          let link;
          if (parsed.searchParams.has('uddg')) {
            link = parsed.searchParams.get('uddg');
          } else if (parsed.searchParams.has('u')) {
            link = parsed.searchParams.get('u');
          } else {
            link = parsed.href;
          }
          link = decodeURIComponent(link);
          new URL(link);
          const snippet = $el.closest('.result').find('.result__snippet').text().trim();
          results.push({ title, href: link, snippet });
        } catch {
          // skip invalid URLs
        }
      });
      
      if (results.length > 0) {
        resultsHtml = `
        <div class="mt-3 mt-md-4">
          <h2 class="text-center mb-2 mb-md-3">Search results for "${q}"</h2>
          <ul class="list-group mb-3 mb-md-4">
        `;
        
        results.forEach(r => {
          resultsHtml += `
          <li class="list-group-item">
            <a href="/proxy?url=${encodeURIComponent(r.href)}">${r.title}</a>
            <p class="mb-1">${r.snippet}</p>
          </li>
          `;
        });
        
        resultsHtml += `</ul></div>`;
      } else {
        resultsHtml = `
        <div class="mt-3 mt-md-4 text-center">
          <h2 class="mb-2 mb-md-3">Search results for "${q}"</h2>
          <p>No results found. Try a different search.</p>
        </div>
        `;
      }
    } catch (error) {
      console.error('Search error:', error.message);
      resultsHtml = `
      <div class="mt-3 mt-md-4 text-center alert alert-danger">
        <p>Search error occurred. Please try again.</p>
      </div>
      `;
    }
  }
  
  // Send complete HTML response
  res.send(`
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>${q ? `Search: ${q} - ` : ''}Cashback-Bot Proxy</title>
    <link href="https://bootswatch.com/5/cyborg/bootstrap.min.css" rel="stylesheet">
    <style>
      /* Mobile-first base styles */
      body { 
        padding: 1rem; 
        font-size: 16px;
      }
      .container { 
        width: 100%;
        padding: 0 10px;
        margin: 0 auto;
      }
      h1 {
        font-size: 1.75rem;
        margin-bottom: 1.25rem;
      }
      h2 {
        font-size: 1.4rem;
        margin-bottom: 1rem;
      }
      .input-group {
        flex-direction: column;
      }
      .input-group .form-control {
        border-radius: 4px;
        margin-bottom: 0.5rem;
        width: 100%;
      }
      .input-group .btn {
        border-radius: 4px;
        width: 100%;
      }
      .list-group-item {
        padding: 0.75rem;
      }
      .list-group-item a {
        font-size: 1.1rem;
        word-break: break-word;
      }
      .list-group-item p {
        font-size: 0.9rem;
        margin-top: 0.5rem;
      }

      /* Larger screens (tablets and up) */
      @media (min-width: 576px) {
        body {
          padding: 1.5rem;
        }
        .container {
          max-width: 540px;
          padding: 0 15px;
        }
        h1 {
          font-size: 2rem;
        }
        .input-group {
          flex-direction: row;
        }
        .input-group .form-control {
          margin-bottom: 0;
          border-top-right-radius: 0;
          border-bottom-right-radius: 0;
        }
        .input-group .btn {
          width: auto;
          border-top-left-radius: 0;
          border-bottom-left-radius: 0;
        }
      }

      /* Desktop screens */
      @media (min-width: 768px) {
        body {
          padding: 2rem;
        }
        .container {
          max-width: 720px;
        }
        h1 {
          font-size: 2.25rem;
        }
      }

      /* Large desktop screens */
      @media (min-width: 992px) {
        .container {
          max-width: 800px;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1 class="text-center mb-4">Cashback-Bot Proxy</h1>
      <form class="input-group mb-3" id="smartForm" action="/" method="get">
        <input type="text" class="form-control" id="smartInput" name="q" placeholder="Enter URL or search query" value="${q || ''}" />
        <button class="btn btn-primary" type="submit">Go</button>
      </form>
      
      ${resultsHtml}
      
    </div>
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.1/dist/js/bootstrap.bundle.min.js"></script>
    <script>
      document.getElementById('smartForm').addEventListener('submit', function(e) {
        e.preventDefault();
        const val = document.getElementById('smartInput').value.trim();
        
        try {
          new URL(val);
          window.location.href = '/proxy?url=' + encodeURIComponent(val);
        } catch (_) {
          window.location.href = '/?q=' + encodeURIComponent(val);
        }
      });
    </script>
  </body>
</html>
  `);
});

app.listen(PORT, () => {
  console.log(`Proxy server listening on port ${PORT}`);
});
