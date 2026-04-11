#!/usr/bin/env node
/**
 * Add "Jamaican Beef Patty Filling" recipe to What a Jerk (company 5)
 *
 * Final SOP: 10kg Scaled Recipe (Complete & Optimized)
 * Integrates MSG, Vinegar for balance, and Oil/Fat contingency.
 * Total Raw Input: ~12.23 kg | Finished: 10 kg
 *
 * Run on staging server:
 *   cd /opt/krawings-portal
 *   ODOO_PASSWORD=<password> node scripts/add-beef-patty-filling-recipe.mjs
 *
 * Or set ODOO_URL / ODOO_DB / ODOO_USER / ODOO_PASSWORD env vars.
 */

const ODOO_URL = process.env.ODOO_URL || 'http://89.167.124.0:15069';
const ODOO_DB = process.env.ODOO_DB || 'krawings';
const ODOO_USER = process.env.ODOO_USER || 'biz@krawings.de';
const ODOO_PASSWORD = process.env.ODOO_PASSWORD;
const COMPANY_ID = 5; // What a Jerk

if (!ODOO_PASSWORD) {
  console.error('ERROR: Set ODOO_PASSWORD environment variable');
  process.exit(1);
}

// -- Odoo JSON-RPC helpers --------------------------------------------------

let sessionId = null;
let uid = null;
let allowedCompanyIds = [];

async function rpc(endpoint, params) {
  const headers = { 'Content-Type': 'application/json' };
  if (sessionId) headers['Cookie'] = `session_id=${sessionId}`;

  const res = await fetch(`${ODOO_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'call', params }),
  });

  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const m = setCookie.match(/session_id=([^;]+)/);
    if (m) sessionId = m[1];
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(`Odoo RPC Error: ${data.error.message} - ${data.error.data?.message || ''}`);
  }
  return data.result;
}

async function authenticate() {
  const result = await rpc('/web/session/authenticate', {
    db: ODOO_DB,
    login: ODOO_USER,
    password: ODOO_PASSWORD,
  });
  uid = result.uid;
  if (!uid) throw new Error('Authentication failed');
  try {
    const uc = result.user_companies;
    if (uc?.allowed_companies) {
      allowedCompanyIds = Object.keys(uc.allowed_companies).map(Number);
    }
  } catch {}
  console.log(`Authenticated as uid=${uid}, companies=${allowedCompanyIds}`);
}

function ctx(extra = {}) {
  return {
    lang: 'en_US',
    tz: 'Europe/Berlin',
    allowed_company_ids: allowedCompanyIds,
    ...extra,
  };
}

async function call(model, method, args = [], kwargs = {}) {
  return rpc('/web/dataset/call_kw', {
    model,
    method,
    args,
    kwargs: { context: ctx(kwargs.context || {}), ...Object.fromEntries(Object.entries(kwargs).filter(([k]) => k !== 'context')) },
  });
}

async function searchRead(model, domain, fields, options = {}) {
  return call(model, 'search_read', [domain], {
    fields,
    limit: options.limit || 200,
    offset: options.offset || 0,
    order: options.order || '',
  });
}

async function create(model, vals) {
  return call(model, 'create', [vals]);
}

// -- Find or create a product -----------------------------------------------

async function findOrCreateProduct(name, uomId = null) {
  const existing = await searchRead(
    'product.product',
    [['name', 'ilike', name]],
    ['id', 'name', 'uom_id'],
    { limit: 5 }
  );

  if (existing.length > 0) {
    console.log(`  Found product: "${existing[0].name}" (id=${existing[0].id})`);
    return existing[0].id;
  }

  const vals = {
    name,
    type: 'consu',
    company_id: false,
  };
  if (uomId) vals.uom_id = uomId;

  const id = await create('product.product', vals);
  console.log(`  Created product: "${name}" (id=${id})`);
  return id;
}

// -- Find UOM by name -------------------------------------------------------

async function findUom(name) {
  let uoms = await searchRead('uom.uom', [['name', '=', name]], ['id', 'name'], { limit: 1 });
  if (uoms.length > 0) return uoms[0].id;
  uoms = await searchRead('uom.uom', [['name', 'ilike', name]], ['id', 'name'], { limit: 5 });
  if (uoms.length > 0) return uoms[0].id;
  return null;
}

// -- Main -------------------------------------------------------------------

async function main() {
  await authenticate();

  // 1. Find UOMs
  console.log('\n--- Finding UOMs ---');
  const kgUom = await findUom('kg');
  if (!kgUom) {
    throw new Error('Could not find kg UOM in Odoo. Check uom.uom records.');
  }
  console.log(`Using weight UOM: kg id=${kgUom}`);

  // 2. Create the output product
  console.log('\n--- Creating output product ---');
  const outputProductId = await findOrCreateProduct('Jamaican Beef Patty Filling (10kg Batch)');

  // 3. Create/find all ingredient products
  console.log('\n--- Finding/creating ingredient products ---');

  const ingredients = [
    // The Base
    { name: 'Ground Beef',                          qty: 2.970, uom: kgUom },
    { name: 'Vegetable Oil',                        qty: 0.150, uom: kgUom }, // only if beef is lean
    // The Aromatics
    { name: 'Yellow Onions (Fresh)',                qty: 1.188, uom: kgUom },
    { name: 'Sweet Yellow Peppers',                 qty: 1.188, uom: kgUom },
    { name: 'Fresh Tomatoes',                       qty: 1.188, uom: kgUom },
    { name: 'Scallions (Fresh)',                    qty: 0.297, uom: kgUom },
    { name: 'Garlic (Fresh)',                       qty: 0.193, uom: kgUom },
    { name: 'Scotch Bonnet Peppers',                qty: 0.193, uom: kgUom },
    // The Seasoning
    { name: 'Kikkoman Soy Sauce',                   qty: 0.594, uom: kgUom },
    { name: 'WAJ Curry Powder',                     qty: 0.079, uom: kgUom },
    { name: 'Allspice (Pimento), ground',           qty: 0.079, uom: kgUom },
    { name: 'Salt (Fine)',                           qty: 0.039, uom: kgUom },
    { name: 'MSG',                                   qty: 0.021, uom: kgUom },
    { name: 'Fresh Thyme',                           qty: 0.022, uom: kgUom },
    { name: 'White Vinegar (5%)',                    qty: 0.020, uom: kgUom },
    // The Binder
    { name: 'Breadcrumbs',                           qty: 1.782, uom: kgUom },
    { name: 'Tap Water',                             qty: 2.376, uom: kgUom },
  ];

  const ingredientLines = [];
  for (const ing of ingredients) {
    const productId = await findOrCreateProduct(ing.name);
    ingredientLines.push({
      product_id: productId,
      product_qty: ing.qty,
      product_uom_id: ing.uom,
    });
  }

  // 4. Get the product template ID for the output product
  console.log('\n--- Getting product template for output ---');
  const outputVariants = await searchRead(
    'product.product',
    [['id', '=', outputProductId]],
    ['product_tmpl_id'],
  );
  const productTmplId = outputVariants[0].product_tmpl_id[0];
  console.log(`Product template id=${productTmplId}`);

  // 5. Create the BOM
  console.log('\n--- Creating BOM ---');
  const bomVals = {
    product_tmpl_id: productTmplId,
    product_id: outputProductId,
    product_qty: 10.0,
    product_uom_id: kgUom,
    company_id: COMPANY_ID,
    type: 'normal',
    x_recipe_guide: true,
    x_recipe_published: false,
    x_recipe_difficulty: 'medium',
    bom_line_ids: ingredientLines.map((line) => [0, 0, line]),
  };

  let bomId;
  try {
    bomId = await create('mrp.bom', bomVals);
    console.log(`Created BOM id=${bomId}`);
  } catch (err) {
    console.warn(`BOM creation with recipe fields failed: ${err.message}`);
    console.log('Retrying without x_recipe_* fields...');
    delete bomVals.x_recipe_guide;
    delete bomVals.x_recipe_published;
    delete bomVals.x_recipe_difficulty;
    bomId = await create('mrp.bom', bomVals);
    console.log(`Created BOM id=${bomId} (without recipe fields)`);
  }

  // 6. Create recipe version with steps
  console.log('\n--- Creating recipe steps ---');

  const steps = [
    {
      sequence: 1,
      step_type: 'cook',
      instruction:
        'Step 1 \u2014 The Saut\u00e9 (The "Flavor Foundation")\n\n' +
        '\u2022 Heat your Vegetable Oil (0.150kg, if using) in a large tilt skillet or pot.\n' +
        '\u2022 Add the Ground Beef (2.970kg). Cook until browned and fully broken down.\n' +
        '\u2022 Add the Onions (1.188kg), Peppers (1.188kg), Scallions (0.297kg), Garlic (0.193kg), and Scotch Bonnet (0.193kg).\n' +
        '\u2022 Saut\u00e9 for 10\u201312 minutes until the vegetables have translucent edges and the sharp "raw" smell is gone.',
      tip: 'Use oil only if beef is lean. Break beef into the smallest crumbles possible during browning.',
      timer_seconds: 720, // 12 min sauté
    },
    {
      sequence: 2,
      step_type: 'cook',
      instruction:
        'Step 2 \u2014 The Seasoning\n\n' +
        '\u2022 Add the Tomato (1.188kg), Soy Sauce (0.594kg), Curry Powder (0.079kg), Allspice (0.079kg), Salt (0.039kg), MSG (0.021kg), and Thyme (0.022kg).\n' +
        '\u2022 Stir vigorously for 2 minutes to toast the spices and deglaze the bottom of the pan.',
      tip: 'Stir vigorously to scrape up all fond (browned bits) from the bottom \u2014 this is concentrated flavor.',
      timer_seconds: 120, // 2 min
    },
    {
      sequence: 3,
      step_type: 'cook',
      instruction:
        'Step 3 \u2014 The Braise\n\n' +
        '\u2022 Pour in the Water (2.376kg) and White Vinegar (0.020kg).\n' +
        '\u2022 Bring to a gentle boil, then lower heat to a simmer.\n' +
        '\u2022 Cover and cook for 20 minutes. The beef should be very tender.',
      tip: 'The vinegar (20g / ~4 teaspoons) won\u2019t make the meat taste sour. It acts as a flavor enhancer \u2014 it makes the MSG and Soy Sauce taste more like "real meat" and makes the spices feel more vibrant on the tongue.',
      timer_seconds: 1200, // 20 min simmer
    },
    {
      sequence: 4,
      step_type: 'cook',
      instruction:
        'Step 4 \u2014 The Binding (The "Patty Paste")\n\n' +
        '\u2022 While the mixture is simmering, slowly add the Breadcrumbs (1.782kg) in stages, stirring constantly.\n' +
        '\u2022 The mixture will thicken into a heavy, glossy paste.\n' +
        '\u2022 Optional: Use an immersion blender for 60 seconds if you want the "Smooth/Traditional" shop-style texture.',
      tip: 'PRO-TIP on "The Oil Look": If you look at a professional Jamaican patty, you\u2019ll notice a thin orange-tinted ring of oil that soaks into the inside of the crust. That comes from the Beef Fat + Curry Powder. If your filling looks "flat" or "matte" after adding breadcrumbs, stir in an extra 50g of butter at the very end. It will give the filling a professional sheen and a much better "mouthfeel."',
      timer_seconds: 300, // 5 min
    },
    {
      sequence: 5,
      step_type: 'prep',
      instruction:
        'Step 5 \u2014 Rapid Chill\n\n' +
        '\u2022 Spread onto flat GN pans (max 2-inch depth).\n' +
        '\u2022 Cool to 4\u00b0C (40\u00b0F) within 4 hours.',
      tip: 'Press plastic wrap directly onto the surface to prevent skin forming. Label with date and "Beef Patty Filling."',
      timer_seconds: 0,
    },
  ];

  try {
    const versionVals = {
      bom_id: bomId,
      version: 1,
      status: 'approved',
      change_summary:
        'Final SOP: 10kg Scaled Recipe (Complete & Optimized). ' +
        'Integrates MSG, Vinegar for balance, and Oil/Fat contingency. ' +
        'Total Raw Input: ~12.23 kg. Target Finished Weight: 10.00 kg. ' +
        'Color: Deep golden-brown/orange. ' +
        'Flavor Profile: Savory, high umami (MSG/Soy), delayed Scotch Bonnet heat, aromatic pimento notes.',
    };
    const versionId = await create('krawings.recipe.version', versionVals);
    console.log(`Created recipe version id=${versionId}`);

    for (const step of steps) {
      const stepId = await create('krawings.recipe.step', {
        ...step,
        version_id: versionId,
        bom_id: bomId,
      });
      console.log(`  Created step ${step.sequence}: id=${stepId}`);
    }

    try {
      await call('mrp.bom', 'write', [[bomId], { x_recipe_published: true }]);
      console.log('Published recipe');
    } catch {
      console.log('Could not set x_recipe_published (field may not exist)');
    }
  } catch (err) {
    console.warn(`Recipe version/steps creation failed: ${err.message}`);
    console.log('The BOM with ingredients was still created successfully.');
    console.log('You can add recipe steps manually through the portal UI.');
  }

  // 7. Summary
  console.log('\n=== DONE ===');
  console.log(`Output Product: "Jamaican Beef Patty Filling (10kg Batch)" (product.product id=${outputProductId})`);
  console.log(`Product Template: id=${productTmplId}`);
  console.log(`BOM: id=${bomId} (company: What a Jerk, id=${COMPANY_ID})`);
  console.log(`Ingredients: ${ingredientLines.length} lines`);
  console.log(`Yield: 10 kg`);
  console.log('\nQuality Control:');
  console.log('- Total Raw Input: ~12.23 kg');
  console.log('- Target Finished Weight: 10.00 kg');
  console.log('- Color: Deep golden-brown/orange');
  console.log('- Flavor: Savory, high umami (MSG/Soy), delayed Scotch Bonnet heat, aromatic pimento notes');
  console.log('- Acid Balance: 20g White Vinegar enhances umami without sourness');
  console.log('- Oil/Fat: 150g Vegetable Oil contingency (only if beef is lean)');
  console.log('- Pro-Tip: Add 50g butter at end if filling looks flat/matte for professional sheen');
  console.log('- Storage: Spread on GN pans, cool to 4\u00b0C within 4 hours');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
