// Generates price-portal XML feeds from the public servispro.lt (Hostinger) store API.
// No dependencies; Node 18+.
import { writeFileSync, mkdirSync } from 'node:fs';

const STORE = 'https://api-ecommerce.hostinger.com/store/scha_01M3V8YV4RKR7HEJB1XR4F3NJM';
const SITE = 'https://www.servispro.lt';
const OUT = new URL('../docs/', import.meta.url);

const get = async (path) => {
  const r = await fetch(STORE + path, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
};

const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cdata = (s = '') => `<![CDATA[${String(s).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
const clean = (html = '') => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const BRAND_FIX = { 'Könner': 'Könner & Söhnen', 'Energy': 'Energy' };
const NO_BRAND = /^(DG\d|ATS-|Trifazio|400V)/i;
const brandOf = (title) => {
  if (NO_BRAND.test(title)) return '';
  const w = title.trim().split(/\s+/)[0];
  return BRAND_FIX[w] || w;
};

// Generator collections are preferred as the product's category; power-range and hidden ones are skipped.
const SKIP_CAT = /^Galia:|priedas$/i;

async function main() {
  const { collections } = await get('/collections?limit=200');
  const catName = Object.fromEntries(collections.map((c) => [c.id, c.title]));

  const products = [];
  for (let offset = 0; ; offset += 100) {
    const r = await get(`/products?limit=100&offset=${offset}`);
    products.push(...r.products);
    if (r.products.length < 100) break;
  }

  const items = [];
  for (const p of products) {
    const v = p.variants?.[0];
    const price = v?.prices?.find((x) => x.currency_code === 'eur');
    if (!v || !price || !v.is_available) continue;
    const amount = ((price.sale_amount ?? price.amount) / 100).toFixed(2);
    const cats = (p.product_collections || [])
      .map((c) => catName[c.collection_id]).filter((n) => n && !SKIP_CAT.test(n));
    const images = (p.images || []).sort((a, b) => a.order - b.order).map((i) => i.url);
    const img = p.thumbnail || images[0] || '';
    items.push({
      id: p.id, title: p.title.replace(/\s+/g, ' ').trim(), price: amount,
      brand: brandOf(p.title), url: `${SITE}/${p.slug || p.url_handle}`,
      img, more: images.filter((u) => u !== img).slice(0, 9),
      cat: cats[0] || 'Generatoriai', desc: clean(p.description).slice(0, 3000),
      cats,
    });
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<root>',
    ...items.map((i) => [
      '  <product id="' + esc(i.id) + '">',
      `    <title>${esc(i.title)}</title>`,
      `    <price>${i.price}</price>`,
      '    <condition>new</condition>',
      `    <manufacturer>${esc(i.brand)}</manufacturer>`,
      `    <image_url>${esc(i.img)}</image_url>`,
      i.more.length ? `    <additional_images>\n${i.more.map((u) => `      <image_url>${esc(u)}</image_url>`).join('\n')}\n    </additional_images>` : null,
      `    <product_url>${esc(i.url)}</product_url>`,
      `    <categories>\n      <category>\n        <name>${esc(i.cat)}</name>\n        <link>${SITE}/prekes</link>\n      </category>\n    </categories>`,
      `    <description>${cdata(i.desc)}</description>`,
      '  </product>',
    ].filter(Boolean).join('\n')),
    '</root>',
    '',
  ].join('\n');

  if (items.length < 50) throw new Error(`Only ${items.length} products – refusing to overwrite feed`);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(new URL('kaina24.xml', OUT), xml);
  console.log(`kaina24.xml: ${items.length} products`);

  // ---- Google Merchant Center (RSS 2.0, g: namespace) ----
  const GOOGLE_CAT = (i) => /priedai|dalys/i.test(i.cat) ? '4709' : '1218'; // Generator Accessories / Generators
  const productType = (i) => ['Generatoriai', ...i.cats.filter((c) => c !== 'Generatoriai')].slice(0, 3).join(' > ');
  const gxml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    '<channel>',
    '<title>Servispro, UAB – generatoriai</title>',
    `<link>${SITE}/prekes</link>`,
    '<description>Servispro el. parduotuvės prekės</description>',
    ...items.map((i) => [
      '<item>',
      `  <g:id>${esc(i.id)}</g:id>`,
      `  <g:title>${esc(i.title.slice(0, 150))}</g:title>`,
      `  <g:description>${esc(i.desc.slice(0, 4900) || i.title)}</g:description>`,
      `  <g:link>${esc(i.url)}</g:link>`,
      `  <g:image_link>${esc(i.img)}</g:image_link>`,
      ...i.more.map((u) => `  <g:additional_image_link>${esc(u)}</g:additional_image_link>`),
      '  <g:availability>in_stock</g:availability>',
      `  <g:price>${i.price} EUR</g:price>`,
      '  <g:condition>new</g:condition>',
      i.brand ? `  <g:brand>${esc(i.brand)}</g:brand>` : '  <g:brand>Servispro</g:brand>',
      '  <g:identifier_exists>no</g:identifier_exists>',
      `  <g:google_product_category>${GOOGLE_CAT(i)}</g:google_product_category>`,
      `  <g:product_type>${esc(productType(i))}</g:product_type>`,
      '</item>',
    ].join('\n')),
    '</channel>',
    '</rss>',
    '',
  ].join('\n');
  writeFileSync(new URL('google.xml', OUT), gxml);
  console.log(`google.xml: ${items.length} products`);

}

main().catch((e) => { console.error(e); process.exit(1); });
