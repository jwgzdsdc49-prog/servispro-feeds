// Generates price-portal XML feeds from the public servispro.lt Shopify store (products.json).
// No dependencies; Node 18+.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const SITE = 'https://www.servispro.lt';
const OUT = new URL('../docs/', import.meta.url);
const MIN_PRICE = 5; // products priced as placeholders (e.g. 1 €, "price on request") are skipped
// Pre-order products (Shopify tag "isankstinis"): supplier ships from Jan 2027
const PREORDER_DATE = '2027-01-15T00:00:00+02:00';
const PREORDER_DAYS = '30-60';
// EAN codes keyed by model (source: manufacturers' own product pages)
const normModel = (m) => m.toUpperCase().replace(/[^A-Z0-9]/g, '');
const EANS = Object.fromEntries(Object.entries(JSON.parse(readFileSync(new URL('./eans.json', import.meta.url), 'utf8'))).map(([k, v]) => [normModel(k), v]));

const get = async (path) => {
  const r = await fetch(SITE + path, { headers: { accept: 'application/json', 'user-agent': 'servispro-feeds/2.0' } });
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
};

// Shopify tags -> shop categories (first match is the main category)
const CATS = [
  ['saules', 'Saulės elektrinės', 'saules-elektrines'],
  ['priedai', 'Generatorių priedai', 'generatoriu-priedai'],
  ['dalys', 'Generatorių dalys', 'generatoriu-dalys'],
  ['stacionarus', 'Stacionarūs generatoriai', 'stacionarus-generatoriai'],
  ['inverterinis', 'Inverteriniai generatoriai', 'inverteriniai-generatoriai'],
  ['dyzelinis', 'Dyzeliniai generatoriai', 'dyzeliniai-generatoriai'],
  ['benzininis', 'Benzininiai generatoriai', 'benzininiai-generatoriai'],
  ['mobilus', 'Mobilūs generatoriai', 'mobilus-generatoriai'],
];
// delivery time in working days, read from the delivery line at the top of the description
function deliveryDays(text) {
  const m = text.match(/Pristatymas per (\d+)\s*[–-]\s*(\d+) darbo dien/i);
  if (m) return `${m[1]}-${m[2]}`;
  if (/Prekė sandėlyje/i.test(text)) return '1-2';
  if (/Pristatymas nuo gruodžio/i.test(text)) return '10-20';
  return '5-9';
}

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
const STOP = /\s(?:-\s|–\s|\(|nuolatinės|dyzelinis|benzininis|inverterinis|dujinis|automatinis|transportavimo|generatoriaus|elektros|tylus|trifazis|vienfazis|suvirinimo|apsauginis|komplektas|kuro|ratukų|ratų|\d+(?:[.,]\d+)?\s?(?:kva|kw|w)\b)/i;
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
  const products = [];
  for (let page = 1; page < 20; page++) {
    const r = await get(`/products.json?limit=250&page=${page}`);
    products.push(...r.products);
    if (r.products.length < 250) break;
  }

  const items = [];
  for (const p of products) {
    const v = p.variants?.[0];
    if (!v) continue;
    const tags = (p.tags || []).map((t) => String(t).toLowerCase());
    // sold out ("Išparduota") products are left out; made-to-order ("Gauti pasiūlymą") ones stay
    if (!v.available && !tags.includes('uzklausa')) continue;
    const amountNum = Number(v.price);
    if (!(amountNum >= MIN_PRICE)) continue;
    const cm = CATS.filter(([t]) => tags.includes(t));
    const cats = cm.map((c) => c[1]);
    const images = (p.images || []).sort((a, b) => a.position - b.position).map((i) => i.src);
    const img = images[0] || '';
    const title = p.title.replace(/\s+/g, ' ').trim();
    const { brand, model } = brandModel(title);
    const desc = clean(p.body_html);
    const preorder = tags.includes('isankstinis');
    const onRequest = tags.includes('uzklausa'); // Electrogen / solar systems: made to order
    items.push({
      id: p.id, title, price: amountNum.toFixed(2), brand: brand || (p.vendor !== 'OTHER' ? p.vendor : ''), model,
      ean: v.barcode || (model ? EANS[normModel(model)] || '' : ''),
      sku: v.sku || '',
      url: `${SITE}/products/${p.handle}`,
      img, more: images.slice(1, 10),
      cat: cats[0] || 'Generatoriai', cats, catLink: cm[0] ? `${SITE}/collections/${cm[0][2]}` : `${SITE}/collections/all`,
      desc: desc.slice(0, 3000), preorder, days: preorder ? PREORDER_DAYS : onRequest ? '14-30' : deliveryDays(desc),
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
      `    <category_link>${cdata(i.catLink)}</category_link>`,
      `    <description>${cdata(i.desc)}</description>`,
      '    <delivery>',
      `      <home_delivery><working_days>${i.days}</working_days><price>0.00</price></home_delivery>`,
      `      <store_pickup><working_days>${i.days}</working_days><price>0.00</price></store_pickup>`,
      '    </delivery>',
      '  </product>',
    ].filter(Boolean).join('\n')),
    '</products>',
    '',
  ].join('\n');
  writeFileSync(new URL('kaina24.xml', OUT), kxml);
  console.log(`kaina24.xml: ${items.length} products (${items.filter((i) => i.model).length} with model, ${items.filter((i) => i.ean).length} with EAN)`);

  // ---- Google Merchant Center (RSS 2.0, g: namespace) ----
  const GOOGLE_CAT = (i) => (/Saulės/i.test(i.cat) ? '' : /priedai|dalys/i.test(i.cat) ? '4709' : '1218'); // Generator Accessories / Generators
  const productType = (i) => (i.cats.length ? i.cats.slice(0, 3).join(' > ') : 'Generatoriai');
  const gxml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    '<channel>',
    '<title>Servispro, UAB – generatoriai</title>',
    `<link>${SITE}/collections/all</link>`,
    '<description>Servispro el. parduotuvės prekės</description>',
    ...items.map((i) => [
      '<item>',
      `  <g:id>${esc(i.id)}</g:id>`,
      `  <g:title>${esc(i.title.slice(0, 150))}</g:title>`,
      `  <g:description>${esc(i.desc.slice(0, 4900) || i.title)}</g:description>`,
      `  <g:link>${esc(i.url)}</g:link>`,
      `  <g:image_link>${esc(i.img)}</g:image_link>`,
      ...i.more.map((u) => `  <g:additional_image_link>${esc(u)}</g:additional_image_link>`),
      i.preorder ? '  <g:availability>preorder</g:availability>' : '  <g:availability>in_stock</g:availability>',
      i.preorder ? `  <g:availability_date>${PREORDER_DATE}</g:availability_date>` : null,
      `  <g:price>${i.price} EUR</g:price>`,
      '  <g:condition>new</g:condition>',
      `  <g:brand>${esc(i.brand || 'Servispro')}</g:brand>`,
      i.ean ? `  <g:gtin>${i.ean}</g:gtin>` : null,
      i.brand && i.model ? `  <g:mpn>${esc(i.model)}</g:mpn>` : '  <g:identifier_exists>no</g:identifier_exists>',
      GOOGLE_CAT(i) ? `  <g:google_product_category>${GOOGLE_CAT(i)}</g:google_product_category>` : null,
      `  <g:product_type>${esc(productType(i))}</g:product_type>`,
      '</item>',
    ].filter(Boolean).join('\n')),
    '</channel>',
    '</rss>',
    '',
  ].join('\n');
  writeFileSync(new URL('google.xml', OUT), gxml);
  // Kainos.lt accepts the Google Merchant format; separate file so it can be filtered independently later
  writeFileSync(new URL('kainos.xml', OUT), gxml);
  console.log(`google.xml + kainos.xml: ${items.length} products`);
}

main().catch((e) => { console.error(e); process.exit(1); });
