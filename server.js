const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const iconv = require('iconv-lite');
const Unblocker = require('unblocker');

const app = express();
const PORT = process.env.PORT || 3000;

const CASHBACK_DOMAIN = 'https://cashback-bot.com';
const CASHBACK_API_DOMAIN = 'https://cashback-bot.com/v1';

// Configure unblocker middleware with custom middleware functions
const unblockerMiddleware = new Unblocker({
  prefix: '/unblock/',
  // Custom request middleware for captcha and cashback handling
  requestMiddleware: [
    function handleCaptcha(data) {
      if (data.url && isCaptchaUrl(data.url)) {
        console.log('Detected captcha URL, bypassing unblocker:', data.url);
        return;
      }
    },
    async function handleCashback(data, next) {
      if (!data.url) return next();
      
      try {
        // Check if URL is eligible for cashback
        const cbRes = await axios.get(`${CASHBACK_API_DOMAIN}/shop/check`, { 
          params: { url: data.url } 
        });
        
        if (cbRes.data?.data?.go_link && cbRes.data.isAuth) {
          const redirectUrl = cbRes.data.data.go_link;
          console.log('Cashback redirect to', redirectUrl);
          data.clientResponse.redirect(redirectUrl);
          return; // Skip further processing
        }
        return next();
      } catch (err) {
        console.error('Cashback check error:', err.message);
        return next();
      }
    }
  ]
});

// Register unblocker middleware - must be before other routes
app.use(unblockerMiddleware);

// Detect captcha and DDOS-Guard URLs to bypass rewriting and proxy adjustments
function isCaptchaUrl(url) {
  return url.includes('h-captcha') || url.includes('hcaptcha') || url.includes('.well-known/ddos-guard');
}

// Helper to modify HTML links for adding our new unblocker path for scripts and fetch
// This function is only used for the homepage now, since unblocker handles proxied content
function rewriteLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  
  // Update client-side JavaScript to use the new unblocker path
  $('head').prepend('<script>(function(){var f=window.fetch;window.fetch=function(i,n){var u=(typeof i=="string"?i:i.url);return f.call(this,"/unblock/"+encodeURIComponent(u),n)};var o=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]="/unblock/"+encodeURIComponent(u);return o.apply(this,arguments)};})();</script>');
  
  // Update form submissions to use the new unblocker path
  $('form[action]').each((_, el) => {
    const $form = $(el);
    const actionVal = $form.attr('action');
    if (!actionVal || actionVal.startsWith('javascript:') || actionVal.startsWith('mailto:') || actionVal.startsWith('#')) return;
    
    // If it's not already a proxy URL, convert it
    if (!actionVal.startsWith('/proxy') && !actionVal.startsWith('/unblock')) {
      try { 
        const absAction = new URL(actionVal, baseUrl).href;
        $form.attr('action', '/unblock/' + encodeURIComponent(absAction));
      } catch { /* ignore invalid URLs */ }
    }
  });
  
  // Update search form and other UI elements to use new paths
  $('a[href]').each((_, el) => {
    const $link = $(el);
    const href = $link.attr('href');
    if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('#')) return;
    
    // If it's a proxy URL, update to the new format
    if (href.startsWith('/proxy?url=')) {
      try {
        const urlParam = new URLSearchParams(href.substring(7)).get('url');
        if (urlParam) {
          $link.attr('href', '/unblock/' + encodeURIComponent(urlParam));
        }
      } catch { /* ignore invalid URLs */ }
    }
  });
  
  return $.html();
}

// Legacy proxy endpoint - Redirects to unblocker format for compatibility
app.get('/proxy', async (req, res) => {
  let targetUrl;
  if (req.query.url) {
    // If it's a captcha URL, use our existing direct proxy logic
    const rawProxyUrl = req.query.url;
    let decodedUrl = decodeURIComponent(rawProxyUrl);
    try {
      // Handle protocol-relative URLs
      if (decodedUrl.startsWith('//')) decodedUrl = 'https:' + decodedUrl;
      const urlObj = new URL(decodedUrl);
      
      // Append other query parameters
      Object.entries(req.query).forEach(([key, val]) => {
        if (key === 'url') return;
        urlObj.searchParams.append(key, val);
      });
      
      targetUrl = urlObj.href;
      
      // Check if it's a captcha/DDOS-Guard URL
      if (isCaptchaUrl(targetUrl)) {
        // Use existing captcha handling logic
        console.log('Using direct proxy for captcha URL:', targetUrl);
        
        try {
          const captchaAxiosOpts = {
            responseType: 'arraybuffer',
            validateStatus: status => status < 500,
            headers: {
              'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
              'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
              'Accept': req.headers['accept'] || '*/*',
              'Referer': targetUrl // Critical for DDOS detection bypass
            },
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
          };

          if (req.headers.cookie) {
            captchaAxiosOpts.headers['Cookie'] = req.headers.cookie;
          }

          const resp = await axios.get(targetUrl, captchaAxiosOpts);

          // Forward any Set-Cookie headers from target to client
          if (resp.headers['set-cookie']) {
            res.setHeader('Set-Cookie', resp.headers['set-cookie']);
          }

          res.set('content-type', resp.headers['content-type'] || '');
          // Send the captcha page completely unmodified. The catch-all route below will handle its assets.
          return res.send(resp.data);
        } catch (e) {
          console.error('Captcha proxy error:', e.message);
          return res.status(500).send('Captcha proxy error');
        }
      } else {
        // Otherwise redirect to the unblocker format
        return res.redirect(`/unblock/${encodeURIComponent(targetUrl)}`);
      }
    } catch (e) {
      console.error('URL parsing error:', e.message);
      return res.status(400).send('Invalid URL');
    }
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
    const requestHeaders = {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
        'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
        'Accept': req.headers['accept'] || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Referer': req.headers['referer'] ? req.headers['referer'].replace(req.headers.host, new URL(targetUrl).host) : new URL(targetUrl).origin + '/', // Adjust referer
        // Forward other relevant headers
        // Be careful not to forward headers that might break things, like Host or proxy-specific headers
      };

      if (req.headers.cookie) {
        requestHeaders['Cookie'] = req.headers.cookie;
      }

    const axiosOpts = {
      responseType: 'arraybuffer',
      validateStatus: status => status < 500,
      headers: requestHeaders,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      maxRedirects: 5 // Allow axios to handle some redirects, but we might need more control
    };
    const response = await axios.get(targetUrl, axiosOpts);

    // Forward Set-Cookie headers from target to client
    const setCookieHeaders = response.headers['set-cookie'];
    if (setCookieHeaders) {
      // Ensure cookies are correctly pathed for the proxy domain if necessary, though often direct forwarding works.
      // For simplicity, direct forwarding first. Complex scenarios might need path rewriting.
      res.setHeader('Set-Cookie', setCookieHeaders);
    }
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
      // Use DuckDuckGo lite HTML endpoint with browser-like headers
      const ddgUrl = 'https://html.duckduckgo.com/html/';
      const ddgRes = await axios.get(ddgUrl, {
        params: { q },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });
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

      // Fallback to Bing RSS search if no DDG results
      if (results.length === 0) {
        try {
          const bingRes = await axios.get('https://www.bing.com/search', {
            params: { q, format: 'rss', mkt: 'en-US' },
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
              'Accept-Language': 'en-US,en;q=0.9'
            }
          });
          const xml = bingRes.data;
          const $xml = cheerio.load(xml, { xmlMode: true });
          $xml('item').each((i, el) => {
            const title = $xml(el).find('title').text().trim();
            const link = $xml(el).find('link').text().trim();
            const snippet = $xml(el).find('description').text().trim();
            if (title && link) results.push({ title, href: link, snippet });
          });
        } catch (e) {
          console.error('Fallback search error:', e.message);
        }
      }

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

// This catch-all route now handles both old proxy and new unblocker formats
app.get('/*', async (req, res) => {
  const referer = req.headers.referer;

  // If this is a direct request with no appropriate referer, return 404
  if (!referer || (!referer.includes('/proxy?url=') && !referer.includes('/unblock/'))) {
    return res.status(404).send('Not Found');
  }

  try {
    let originalTargetUrl;
    const refererUrl = new URL(referer);
    
    if (referer.includes('/proxy?url=')) {
      // Legacy format
      originalTargetUrl = refererUrl.searchParams.get('url');
    } else if (referer.includes('/unblock/')) {
      // New unblocker format - extract the URL from the path
      const parts = refererUrl.pathname.split('/unblock/');
      if (parts.length > 1) {
        originalTargetUrl = decodeURIComponent(parts[1]);
      }
    }

    if (!originalTargetUrl) {
      return res.status(400).send('Bad Request: Missing original URL in referer.');
    }
    
    // For non-captcha URLs, redirect to the unblocker format
    if (!isCaptchaUrl(originalTargetUrl)) {
      // If this is a direct asset request, redirect through unblocker
      return res.redirect(`/unblock/${encodeURIComponent(originalTargetUrl + req.originalUrl)}`);
    }
    
    // For captcha/DDOS-Guard URLs, continue with direct proxying
    const assetUrl = new URL(req.originalUrl, originalTargetUrl).href;
    
    console.log(`Direct proxying captcha asset: ${assetUrl}`);

    const assetAxiosOpts = {
      responseType: 'arraybuffer',
      validateStatus: status => status < 500,
      headers: {
        'User-Agent': req.headers['user-agent'],
        'Accept-Language': req.headers['accept-language'],
        'Accept': req.headers['accept'],
        'Referer': originalTargetUrl, // Set referer to the original page
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    };
    if (req.headers.cookie) {
      assetAxiosOpts.headers['Cookie'] = req.headers.cookie;
    }

    const resp = await axios.get(assetUrl, assetAxiosOpts);

    const respSetCookieHeaders = resp.headers['set-cookie'];
    if (respSetCookieHeaders) {
      res.setHeader('Set-Cookie', respSetCookieHeaders);
    }
    
    res.set('content-type', resp.headers['content-type']);
    res.send(resp.data);

  } catch (e) {
    console.error(`Asset proxy error for ${req.originalUrl}:`, e.message);
    res.status(500).send('Asset proxy error');
  }
});

app.listen(PORT, () => {
  console.log(`Proxy server listening on port ${PORT}`);
});
