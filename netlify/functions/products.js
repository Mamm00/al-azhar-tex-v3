// netlify/functions/products.js
// GET  /api/products          → list all (with optional ?category= filter)
// POST /api/products          → create new product
//
// Data is persisted via GitHub API so changes survive redeploys.
// Required env vars:
//   GITHUB_TOKEN   – personal access token (repo scope)
//   GITHUB_OWNER   – your GitHub username or org
//   GITHUB_REPO    – repository name
//   ADMIN_SECRET   – optional extra header secret for POST/PUT/DELETE

const DATA_PATH = 'src/_data/products.json';

/* ── GitHub helpers ─────────────────────────────────────────── */
async function ghGet(owner, repo, path, token) {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
  );
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
  const data = await res.json();
  return {
    content: JSON.parse(Buffer.from(data.content, 'base64').toString('utf8')),
    sha: data.sha
  };
}

async function ghPut(owner, repo, path, token, content, sha, message) {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message,
        content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'),
        sha
      })
    }
  );
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`GitHub PUT failed: ${res.status} – ${err.message}`);
  }
  return res.json();
}

/* ── Auth check ─────────────────────────────────────────────── */
function isAuthorized(event, context) {
  // Check Netlify Identity JWT (set by Netlify automatically)
  const user = context?.clientContext?.user;
  if (user) return true;
  // Fallback: custom secret header
  const secret = process.env.ADMIN_SECRET;
  if (secret && event.headers['x-admin-secret'] === secret) return true;
  return false;
}

/* ── Validation ─────────────────────────────────────────────── */
function validate(body) {
  const errors = [];
  if (!body.name_en?.trim()) errors.push('name_en is required');
  if (!body.name_ar?.trim()) errors.push('name_ar is required');
  if (!body.category?.trim()) errors.push('category is required');
  return errors;
}

/* ── Handler ────────────────────────────────────────────────── */
exports.handler = async (event, context) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-secret',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  // Preflight
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;

  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: 'Server misconfigured: missing GitHub env vars. Set GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO in Netlify → Site Settings → Environment.' })
    };
  }

  try {
    /* ── GET: list products ───────────────────────────────── */
    if (event.httpMethod === 'GET') {
      const { content: products } = await ghGet(GITHUB_OWNER, GITHUB_REPO, DATA_PATH, GITHUB_TOKEN);
      const { category, status, q, page = '1', limit = '10' } = event.queryStringParameters || {};

      let result = [...products];
      if (category && category !== 'all') result = result.filter(p => p.category === category);
      if (status) result = result.filter(p => p.status === status);
      if (q) {
        const lq = q.toLowerCase();
        result = result.filter(p =>
          p.name_en.toLowerCase().includes(lq) ||
          p.name_ar.includes(q)
        );
      }

      const total = result.length;
      const pageNum = Math.max(1, parseInt(page));
      const pageSize = Math.min(50, Math.max(1, parseInt(limit)));
      const start = (pageNum - 1) * pageSize;
      const paginated = result.slice(start, start + pageSize);

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ data: paginated, total, page: pageNum, pages: Math.ceil(total / pageSize) })
      };
    }

    /* ── POST: create product ─────────────────────────────── */
    if (event.httpMethod === 'POST') {
      if (!isAuthorized(event, context)) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      }

      const body = JSON.parse(event.body || '{}');
      const errors = validate(body);
      if (errors.length) return { statusCode: 400, headers, body: JSON.stringify({ errors }) };

      const { content: products, sha } = await ghGet(GITHUB_OWNER, GITHUB_REPO, DATA_PATH, GITHUB_TOKEN);

      const maxId = products.reduce((m, p) => Math.max(m, parseInt(p.id) || 0), 0);
      const newProduct = {
        id: String(maxId + 1),
        name_en: body.name_en.trim(),
        name_ar: body.name_ar.trim(),
        category: body.category.trim(),
        description_en: body.description_en?.trim() || '',
        description_ar: body.description_ar?.trim() || '',
        image_url: body.image_url?.trim() || '',
        width: body.width?.trim() || '',
        wholesale_note: body.wholesale_note?.trim() || '',
        status: body.status === 'draft' ? 'draft' : 'active',
        created_at: new Date().toISOString().split('T')[0]
      };

      await ghPut(
        GITHUB_OWNER, GITHUB_REPO, DATA_PATH, GITHUB_TOKEN,
        [...products, newProduct], sha,
        `[admin] Add product: ${newProduct.name_en}`
      );

      return { statusCode: 201, headers, body: JSON.stringify(newProduct) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (err) {
    console.error('products.js error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
