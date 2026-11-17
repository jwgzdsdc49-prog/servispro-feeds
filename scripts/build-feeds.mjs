// Generates price-portal XML feeds from the public servispro.lt (Hostinger) store API.
// No dependencies; Node 18+.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const STORE = 'https://api-ecommerce.hostinger.com/store/scha_01M3V8YV4RKR7HEJB1XR4F3NJM';
const SITE = 'https://www.servispro.lt';
const OUT = new URL('../docs/', import.meta.url);
const MIN_PRICE = 5;
// EAN codes keyed by model (source: manufacturers' own product pages)
const normModel = (m) => m.toUpperCase().replace(/[^A-Z0-9]/g, '');
const EANS = Object.fromEntries(Object.entries(JSON.parse(readFileSync(new URL('./eans.json', import.meta.url), 'utf8'))).map(([k, v]) => [normModel(k), v])); // products priced as placeholders (e.g. 1 €, "price on request") are skipped

const get = async (path) => {
  const r = await fetch(STORE + path, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
};

const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cdata = (s = '') => `<![CDATA[${String(s).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
const clean = (html = '') => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// ---- brand + model extraction from the product title ----
const BRANDS = [
  ['Könner & Söhnen', /^K[öo]nner\s*&\s*S[öo]hnen\s+/i],
  ['Electrogen', /^Electrogen\s+/i], ['Genergy', /^Genergy\s+/i], ['Pramac', /^Pramac\s+/i],
  ['GeoTech', /^GeoTech\s+/i], ['BullMach', /^BullMach\s+/i], ['BlackStone', /^BlackStone\s+/i],
  ['Hyundai', /^Hyundai\s+/i], ['TecnoGen', /^TecnoGen\s+/i], ['Honda', /^Honda\s+/i],
  ['Stanley', /^Stanley\s+/i], ['Einhell', /^Einhell\s+/i], ['Energy', /^Energy\s+/i],
  ['Rato', /^Rato\s+/i], ['Mosa', /^Mosa\s+/i], ['Valex', /^Valex\s+/i], ['AGT', /^AGT\s+/i],
  ['AMA', /^AMA\s+/i], ['Vinco', /^Vinco\s+/i],
];
// first Lithuanian descriptive word ends the model part of the title
const STOP = /\s(?:-\s|–\s|\(|dyzelinis|benzininis|inverterinis|dujinis|automatinis|transportavimo|generatoriaus|elektros|tylus|trifazis|vienfazis|suvirinimo|apsauginis|komplektas|kuro|ratukų|ratų|\d+(?:[.,]\d+)?\s?(?:kva|kw|w)\b)/i;
function brandModel(title) {
  const t = title.replace(/\s+/g, ' ').trim();
  for (const [name, re] of BRANDS) {
    if (re.test(t)) {
      const rest = t.replace(re, '');
      const m = rest.split(STOP)[0].trim();
      return { brand: name, model: m && m.length <= 40 ? m : '' };
    }
  }
  const dg = t.match(/^(DG\d{4,5}SE\d?J?)\b/i);
  if (dg) return { brand: '', model: dg[1].toUpperCase() };
  const ats = t.match(/^(ATS-\d+)/i);
  if (ats) return { brand: '', model: ats[1].toUpperCase() };
  return { brand: '', model: '' };
}

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
    const amountNum = (price.sale_amount ?? price.amount) / 100;
    if (amountNum < MIN_PRICE) continue;
    const cats = (p.product_collections || [])
      .map((c) => catName[c.collection_id]).filter((n) => n && !SKIP_CAT.test(n));
    const images = (p.images || []).sort((a, b) => a.order - b.order).map((i) => i.url);
    const img = p.thumbnail || images[0] || '';
    const title = p.title.replace(/\s+/g, ' ').trim();
    const { brand, model } = brandModel(title);
    items.push({
      id: p.id, title, price: amountNum.toFixed(2), brand, model,
      ean: model ? EANS[normModel(model)] || '' : '',
      sku: v.sku || '',
      url: `${SITE}/${p.slug || p.url_handle}`,
      img, more: images.filter((u) => u !== img).slice(0, 9),
      cat: cats[0] || 'Generatoriai', cats, desc: clean(p.description).slice(0, 3000),
    });
  }
  if (items.length < 50) throw new Error(`Only ${items.length} products – refusing to overwrite feed`);
  mkdirSync(OUT, { recursive: true });

  // ---- Kaina24.lt (format per https://www.kaina24.lt/xml/example.xml) ----
  const kxml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<products>',
    ...items.map((i) => [
      `  <product id="${esc(i.id)}">`,
      `    <title>${cdata(i.title)}</title>`,
      `    <price>${i.price}</price>`,
      '    <condition>new</condition>',
      i.ean ? `    <ean_code>${i.ean}</ean_code>` : null,
      i.model ? `    <manufacturer_code>${cdata(i.sku || i.model)}</manufacturer_code>` : null,
      i.brand ? `    <manufacturer>${cdata(i.brand)}</manufacturer>` : null,
      i.model ? `    <model>${cdata(i.model)}</model>` : null,
      `    <image_url>${cdata(i.img)}</image_url>`,
      i.more.length ? `    <additional_images>\n${i.more.map((u) => `      <image>${cdata(u)}</image>`).join('\n')}\n    </additional_images>` : null,
      `    <product_url>${cdata(i.url)}</product_url>`,
      `    <category_name>${cdata(i.cat)}</category_name>`,
      `    <category_link>${cdata(SITE + '/prekes')}</category_link>`,
      `    <description>${cdata(i.desc)}</description>`,
      '    <delivery>',
      '      <home_delivery><working_days>1-3</working_days><price>0.00</price></home_delivery>',
      '      <store_pickup><working_days>1</working_days><price>0.00</price></store_pickup>',
      '    </delivery>',
      '  </product>',
    ].filter(Boolean).join('\n')),
    '</products>',
    '',
  ].join('\n');
  writeFileSync(new URL('kaina24.xml', OUT), kxml);
  console.log(`kaina24.xml: ${items.length} products (${items.filter((i) => i.model).length} with model, ${items.filter((i) => i.ean).length} with EAN)`);

  // ---- Google Merchant Center (RSS 2.0, g: namespace) ----
  const GOOGLE_CAT = (i) => (/priedai|dalys/i.test(i.cat) ? '4709' : '1218'); // Generator Accessories / Generators
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
      `  <g:brand>${esc(i.brand || 'Servispro')}</g:brand>`,
      i.ean ? `  <g:gtin>${i.ean}</g:gtin>` : null,
      i.brand && i.model ? `  <g:mpn>${esc(i.model)}</g:mpn>` : '  <g:identifier_exists>no</g:identifier_exists>',
      `  <g:google_product_category>${GOOGLE_CAT(i)}</g:google_product_category>`,
      `  <g:product_type>${esc(productType(i))}</g:product_type>`,
      '</item>',
    ].filter(Boolean).join('\n')),
    '</channel>',
    '</rss>',
    '',
  ].join('\n');
  writeFileSync(new URL('google.xml', OUT), gxml);
  console.log(`google.xml: ${items.length} products`);
}

main().catch((e) => { console.error(e); process.exit(1); });
