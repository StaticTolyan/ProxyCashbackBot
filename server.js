const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const iconv = require('iconv-lite');

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
  // Inject proxying for dynamic fetch and XHR
  $('head').prepend('<script>(function(){var f=window.fetch;window.fetch=function(i,n){var u=(typeof i=="string"?i:i.url);return f.call(this,"/proxy?url="+encodeURIComponent(u),n)};var o=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]="/proxy?url="+encodeURIComponent(u);return o.apply(this,arguments)};})();</script>');
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
    { selector: 'script[src]', attr: 'src' },
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
    const axiosOpts = {
      responseType: 'arraybuffer',
      validateStatus: status => status < 500,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    };
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
app.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) {
    res.send(`
<!DOCTYPE html>
<html lang='en'>
<head>
  <meta charset='UTF-8'>
  <meta name='viewport' content='width=device-width, initial-scale=1.0'>
  <title>Proxy Search - Cashback-Bot Proxy</title>
  <link href='https://bootswatch.com/5/cyborg/bootstrap.min.css' rel='stylesheet'>
  <style>
    body { padding: 2rem; }
    .container { max-width: 800px; }
  </style>
</head>
<body>
  <div class='container'>
    <h1 class='text-center mb-4'>Proxy Search</h1>
    <form class='input-group mb-3' method='get' action='/search'>
      <input type='text' class='form-control' name='q' placeholder='Search DuckDuckGo' aria-label='Search query' />
      <button class='btn btn-primary' type='submit'>Search</button>
    </form>
    <div>
      <a href='/' class='btn btn-link'>Home</a>
    </div>
  </div>
  <script src='https://cdn.jsdelivr.net/npm/bootstrap@5.3.1/dist/js/bootstrap.bundle.min.js'></script>
</body>
</html>
    `);
    return;
  }
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
    let resultHtml = `
<!DOCTYPE html>
<html lang='en'>
<head>
  <meta charset='UTF-8'>
  <meta name='viewport' content='width=device-width, initial-scale=1.0'>
  <title>Search results for &quot;${q}&quot; - Cashback-Bot Proxy</title>
  <link href='https://bootswatch.com/5/cyborg/bootstrap.min.css' rel='stylesheet'>
  <style>
    body { padding: 2rem; }
    .container { max-width: 800px; }
  </style>
</head>
<body>
  <div class='container'>
    <h1 class='text-center mb-4'>Search results for &quot;${q}&quot;</h1>
    <ul class='list-group'>
`;
    results.forEach(r => {
      resultHtml += `
      <li class='list-group-item'>
        <a href='/proxy?url=${encodeURIComponent(r.href)}'>${r.title}</a>
        <p class='mb-1'>${r.snippet}</p>
      </li>
`;
    });
      resultHtml += `
    </ul>
    <div class='mt-3'>
      <a href='/search' class='btn btn-secondary'>New search</a>
      <a href='/' class='btn btn-link'>Home</a>
    </div>
  </div>
  <script src='https://cdn.jsdelivr.net/npm/bootstrap@5.3.1/dist/js/bootstrap.bundle.min.js'></script>
</body>
</html>
`;
    res.set('content-type', 'text/html');
    res.send(resultHtml);
  } catch (error) {
    console.error('Search error:', error.message);
    res.status(500).send('Search error');
  }
});

// Root - simple form
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cashback-Bot Proxy</title>
    <link href="https://bootswatch.com/5/cyborg/bootstrap.min.css" rel="stylesheet">
    <style>
      body { padding: 2rem; }
      .container { max-width: 800px; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1 class="text-center mb-4">Cashback-Bot Proxy</h1>
      <form class="input-group mb-3" id="smartForm">
        <input type="text" class="form-control" id="smartInput" placeholder="Enter URL or search query" />
        <button class="btn btn-primary" type="submit">Go</button>
      </form>
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
          window.location.href = '/search?q=' + encodeURIComponent(val);
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
