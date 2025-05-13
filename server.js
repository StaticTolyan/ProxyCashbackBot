const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const iconv = require('iconv-lite');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

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
      // Enhanced CAPTCHA URL detection
      var isCaptchaUrl = function(url) {
        return (
          url.includes('recaptcha') || 
          url.includes('hcaptcha.com') || 
          url.includes('challenges.cloudflare.com') ||
          url.includes('captcha') ||
          url.includes('arkoselabs') ||
          url.includes('funcaptcha')
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
        return originalOpen.apply(this, arguments);
      };
      
      // Override XHR send to track verification responses
      XMLHttpRequest.prototype.send = function(body) {
        var xhr = this;
        
        // If this is a verification request, monitor its completion
        if (xhr._originalUrl && (xhr._originalUrl.includes('verify') || xhr._originalUrl.includes('siteverify'))) {
          var originalOnLoad = xhr.onload;
          xhr.onload = function() {
            console.log("CAPTCHA verification XHR completed");
            if (originalOnLoad) originalOnLoad.apply(this, arguments);
          };
        }
        
        // Continue with original send
        return originalSend.apply(this, arguments);
      };
      
      // Hook into hCaptcha specific callbacks
      window.addEventListener('DOMContentLoaded', function() {
        // Check for hCaptcha scripts and setup callback handler
        setTimeout(function() {
          if (window.hcaptcha) {
            console.log("hCaptcha detected, setting up hooks");
            var originalRender = window.hcaptcha.render;
            window.hcaptcha.render = function(container, params) {
              // Ensure callback works
              var originalCallback = params && params.callback;
              if (originalCallback) {
                params.callback = function(token) {
                  console.log("hCaptcha verification successful", token.substring(0,10) + "...");
                  // Trigger form submission after successful verification
                  setTimeout(function() {
                    if (originalCallback) originalCallback(token);
                    // Find the form containing the hCaptcha element and submit it
                    var containerEl = typeof container === 'string' ? document.getElementById(container) : container;
                    if (containerEl) {
                      var form = containerEl.closest('form');
                      if (form) {
                        console.log("Submitting form after hCaptcha verification");
                        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                      }
                    }
                  }, 500);
                };
              }
              return originalRender.apply(this, arguments);
            };
          }
          
          // Similar handling for other CAPTCHA types if needed
        }, 1000);
      });
    })();
  </script>`);
  // Preserve CAPTCHA scripts
  $('script').each((_, el) => {
    const $script = $(el);
    const src = $script.attr('src');
    
    // Don't modify inline scripts for CAPTCHAs or scripts that load CAPTCHAs
    if ($script.html() && (
        $script.html().includes('recaptcha') || 
        $script.html().includes('hcaptcha') || 
        $script.html().includes('captcha') ||
        $script.html().includes('challenges.cloudflare')
      )) {
      // Mark this script to be preserved
      $script.attr('data-preserve-captcha', 'true');
    }
    
    // Don't modify script src for CAPTCHA services
    if (src && (
        src.includes('recaptcha') || 
        src.includes('hcaptcha.com') || 
        src.includes('challenges.cloudflare.com') ||
        src.includes('captcha')
      )) {
      // Keep the original src
      $script.attr('data-original-src', src);
      $script.removeAttr('src'); // Will be restored later
    }
  });
  
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
    // Build axios options, mimic browser, and accept up to 4xx status for proxying
    // Check if the URL is for a CAPTCHA service
    const isCaptchaUrl = targetUrl.includes('recaptcha') || 
                        targetUrl.includes('hcaptcha.com') || 
                        targetUrl.includes('challenges.cloudflare.com') ||
                        targetUrl.includes('captcha') ||
                        targetUrl.includes('arkoselabs') ||
                        targetUrl.includes('funcaptcha') ||
                        targetUrl.includes('verify') ||
                        targetUrl.includes('siteverify') ||
                        targetUrl.includes('anchor');
    
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
        'Upgrade-Insecure-Requests': '1'
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    };
    
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
