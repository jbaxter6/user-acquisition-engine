import { chromium } from 'playwright';

function assertTargetUrl() {
  const value = (process.env.OPP1_URL || '').trim();
  if (!value) {
    throw new Error('Missing OPP1_URL env var.');
  }
  return value;
}

function normalizeName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–—]\s*/g, '-')
    .trim();
}

function sanitizeHandle(value) {
  let cleaned = String(value || '').trim().replace(/^@/, '');
  cleaned = cleaned.replace(/([a-z0-9._-])([A-Z].*)$/, '$1');
  cleaned = cleaned.replace(/[^a-zA-Z0-9._-].*$/, '');
  return cleaned;
}

function extractHandle(cardText) {
  const match = (cardText || '').match(/@([a-zA-Z0-9._-]+)/i);
  return sanitizeHandle(match ? match[1] : '');
}

function inferArtistName(cardText, handle) {
  const cleaned = normalizeName(cardText || '');
  const beforeHandle = cleaned.split(/@/)[0] || '';
  let name = beforeHandle
    .replace(/^(?:LIVE|nero|Streaming on|Live\s*|LIVE\s*)/gi, '')
    .replace(/\b(?:Submit|Send|Giving away a FREE FEATURE|Music Reviews|Song Review|LIVE)\b.*$/i, '')
    .trim();

  if (name && !/^(?:LIVE|nero)$/i.test(name)) return name;
  if (handle) return handle;
  return 'artist';
}

async function extractProfileCandidates(page) {
  return page.evaluate(() => {
    const slugify = (value) => String(value || '')
      .toLowerCase()
      .trim()
      .replace(/^@/, '')
      .replace(/([a-z0-9._-])([A-Z].*)$/, '$1')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-+/g, '-');

    const results = new Map();
    const seen = new Set();

    for (const card of document.querySelectorAll('[role="link"][aria-label]')) {
      const label = (card.getAttribute('aria-label') || '').trim();
      if (!label) continue;

      let handle = '';
      for (const anchor of card.querySelectorAll('a[href]')) {
        const href = (anchor.getAttribute('href') || '').trim();
        if (!href) continue;

        try {
          const url = new URL(href, window.location.href);
          const host = url.hostname.toLowerCase();
          const match = url.pathname.match(/@?([a-zA-Z0-9._-]+)/);
          if ((host.includes('tiktok.com') || host.includes('instagram.com') || host.includes('youtube.com') || host.includes('twitch.tv')) && match) {
            handle = match[1];
            break;
          }
        } catch {
          // skip malformed link
        }
      }

      if (!handle) {
        const handleMatch = label.match(/@([a-zA-Z0-9._-]+)/i) || label.match(/([a-zA-Z0-9._-]+)\s*:\s*/i);
        if (handleMatch) handle = handleMatch[1];
      }

      if (!handle) continue;
      const normalizedHandle = slugify(handle);
      if (!normalizedHandle || seen.has(normalizedHandle)) continue;
      seen.add(normalizedHandle);

      const profileUrl = `https://www.nero.fan/${normalizedHandle}`;
      const titleEl = card.querySelector('h3');
      const title = (titleEl?.textContent || label.split(':')[0] || label).replace(/\s+/g, ' ').trim();
      if (!results.has(profileUrl)) {
        results.set(profileUrl, { url: profileUrl, title });
      }
    }

    return [...results.values()];
  });
}

function extractSocialsFromProfile(page) {
  return page.evaluate(() => {
    const socials = { instagram: '', tiktok: '', youtube: '', twitch: '' };

    for (const anchor of document.querySelectorAll('a[href]')) {
      const href = (anchor.getAttribute('href') || '').trim();
      if (!href) continue;

      try {
        const url = new URL(href, window.location.href);
        const host = url.hostname.toLowerCase();
        const finalUrl = url.href;

        if (host.includes('instagram.com')) socials.instagram = finalUrl;
        if (host.includes('tiktok.com')) socials.tiktok = finalUrl;
        if (host.includes('youtube.com')) socials.youtube = finalUrl;
        if (host.includes('twitch.tv')) socials.twitch = finalUrl;
      } catch {
        // skip malformed links
      }
    }

    return socials;
  });
}

export async function runStrategy() {
  const targetUrl = assertTargetUrl();
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    });

    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });

    const candidates = await extractProfileCandidates(page);
    const results = [];

    for (const item of candidates) {
      const handle = extractHandle(item.title);
      const profileUrl = item.url;

      const profilePage = await browser.newPage({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      });

      try {
        await profilePage.goto(profileUrl, { waitUntil: 'networkidle', timeout: 60000 });

        const titleText = await profilePage.evaluate(() => {
          const candidates = [...document.querySelectorAll('h1, h2, h3')]
            .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
            .filter((text) => text && !/^nero$/i.test(text) && !/^live$/i.test(text) && !/giving away a free feature/i.test(text) && !/submit|send|music reviews|song review/i.test(text));

          return candidates[0] || document.title.split('|')[0].trim() || '';
        });

        const safeTitleText = titleText && !/creator not found/i.test(titleText) ? titleText : '';
        const socials = await extractSocialsFromProfile(profilePage);
        const artistName = inferArtistName(safeTitleText || item.title, handle);
        const record = {
          name: normalizeName(artistName),
          profileUrl,
          instagram: socials.instagram || '',
          tiktok: socials.tiktok || '',
          youtube: socials.youtube || '',
          twitch: socials.twitch || '',
          sourcePage: targetUrl,
        };

        if (record.name && record.name !== 'artist') {
          results.push(record);
        }
      } catch {
        // skip bad profile pages
      } finally {
        await profilePage.close();
      }
    }

    const unique = new Map();
    for (const record of results) {
      const key = `${record.name}|${record.profileUrl}`;
      if (!unique.has(key)) unique.set(key, record);
    }

    return { source: targetUrl, count: unique.size, prospects: [...unique.values()] };
  } finally {
    await browser.close();
  }
}
