// netlify/functions/products-id.js
// PUT    /api/products/:id   → update product
// DELETE /api/products/:id   → delete product
//
// Called via redirect: /api/products/:id → /.netlify/functions/products-id?id=:id

const DATA_PATH = 'src/_data/products.json';

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

function isAuthorized(event, context) {
  const user = context?.clientContext?.user;
  if (user) return true;
  const secret = process.env.ADMIN_SECRET;
  if (secret && event.headers['x-admin-secret'] === secret) return true;
  return false;
}

exports.handler = async (event, context) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-secret',
    'Access-Control-Allow-Methods': 'GET, PUT, PATCH, DELETE, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  if (!isAuthorized(event, context)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // Extract ID from path or query string
  // Path: /.netlify/functions/products-id/123  or  query: ?id=123
  const pathId = event.path?.split('/').pop();
  const id = event.queryStringParameters?.id || (pathId !== 'products-id' ? pathId : null);

  if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Product ID is required' }) };

  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing GitHub env vars' }) };
  }

  try {
    const { content: products, sha } = await ghGet(GITHUB_OWNER, GITHUB_REPO, DATA_PATH, GITHUB_TOKEN);
    const idx = products.findIndex(p => String(p.id) === String(id));

    if (idx === -1) return { statusCode: 404, headers, body: JSON.stringify({ error: `Product ${id} not found` }) };

    /* ── GET single ───────────────────────────────────────── */
    if (event.httpMethod === 'GET') {
      return { statusCode: 200, headers, body: JSON.stringify(products[idx]) };
    }

    /* ── PUT / PATCH: update ──────────────────────────────── */
    if (event.httpMethod === 'PUT' || event.httpMethod === 'PATCH') {
      const body = JSON.parse(event.body || '{}');

      const updated = {
        ...products[idx],
        ...(body.name_en      && { name_en: body.name_en.trim() }),
        ...(body.name_ar      && { name_ar: body.name_ar.trim() }),
        ...(body.category     && { category: body.category.trim() }),
        ...(body.description_en !== undefined && { description_en: body.description_en.trim() }),
        ...(body.description_ar !== undefined && { description_ar: body.description_ar.trim() }),
        ...(body.image_url    !== undefined && { image_url: body.image_url.trim() }),
        ...(body.width        !== undefined && { width: body.width.trim() }),
        ...(body.wholesale_note !== undefined && { wholesale_note: body.wholesale_note.trim() }),
        ...(body.status       && { status: body.status }),
        updated_at: new Date().toISOString().split('T')[0]
      };

      const newProducts = [...products];
      newProducts[idx] = updated;

      await ghPut(
        GITHUB_OWNER, GITHUB_REPO, DATA_PATH, GITHUB_TOKEN,
        newProducts, sha,
        `[admin] Update product ${id}: ${updated.name_en}`
      );

      return { statusCode: 200, headers, body: JSON.stringify(updated) };
    }

    /* ── DELETE ───────────────────────────────────────────── */
    if (event.httpMethod === 'DELETE') {
      const deleted = products[idx];
      const newProducts = products.filter(p => String(p.id) !== String(id));

      await ghPut(
        GITHUB_OWNER, GITHUB_REPO, DATA_PATH, GITHUB_TOKEN,
        newProducts, sha,
        `[admin] Delete product ${id}: ${deleted.name_en}`
      );

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, deleted }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (err) {
    console.error('products-id.js error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
