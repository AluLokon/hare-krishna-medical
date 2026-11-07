const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function getCategory(packSize, name) {
  const ps = (packSize || '').toLowerCase();
  const nm = (name || '').toLowerCase();
  if (/injection|vial|infusion/.test(ps)) return 'Injections';
  if (/syrup|suspension|solution|elixir|expectorant/.test(ps)) return 'Syrups';
  if (/cream|ointment|lotion|gel/.test(ps)) return 'Creams & Gels';
  if (/drop|ophthalmic/.test(ps)) return 'Drops';
  if (/inhaler|rotacap|nebulizer/.test(ps)) return 'Inhalers';
  if (/capsule|cap\b/.test(ps)) return 'Capsules';
  if (/tablet|tab\b/.test(ps)) return 'Tablets';
  if (/powder|sachet/.test(ps)) return 'Powders';
  if (/syrup|syr/.test(nm)) return 'Syrups';
  if (/\btab\b/.test(nm)) return 'Tablets';
  if (/\bcap\b/.test(nm)) return 'Capsules';
  if (/\binj\b/.test(nm)) return 'Injections';
  if (/cream|gel/.test(nm)) return 'Creams & Gels';
  return 'Other';
}

function getIcon(cat) {
  const icons = { 'Tablets':'💊','Capsules':'💊','Syrups':'🍶',
    'Injections':'💉','Creams & Gels':'🧴','Drops':'👁️',
    'Inhalers':'🌬️','Powders':'🫙','Medical Devices':'🩺','Other':'💊' };
  return icons[cat] || '💊';
}

async function run() {
  console.log('Reading medicine data...');
  const raw = fs.readFileSync('medicine_data.json', 'utf8');
  const data = JSON.parse(raw);
  const active = data.filter(m => m.Is_discontinued === 'FALSE');
  console.log(`Total active medicines: ${active.length}`);

  // Create index for fast search
  console.log('Creating search index...');
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_medicines_name_lower ON medicines (lower(name) text_pattern_ops)`);
  
  const before = await pool.query('SELECT COUNT(*) FROM medicines');
  console.log('Medicines in DB before:', before.rows[0].count);

  // Insert in batches of 500
  const BATCH = 500;
  let inserted = 0;
  
  for (let i = 0; i < active.length; i += BATCH) {
    const batch = active.slice(i, i + BATCH);
    const values = [];
    const params = [];
    let p = 1;
    
    for (const m of batch) {
      const name = (m.name || '').substring(0, 200);
      const brand = (m.manufacturer_name || '').substring(0, 200);
      const price = parseFloat(m['price(₹)'] || 0) || 0;
      const pack = m.pack_size_label || '';
      const category = getCategory(pack, name);
      const icon = getIcon(category);
      
      values.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},false,100,false)`);
      params.push(name, brand, price, category, icon);
      p += 5;
    }
    
    const sql = `INSERT INTO medicines (name,brand,price,category,icon,requires_rx,stock,featured) VALUES ${values.join(',')} ON CONFLICT DO NOTHING`;
    await pool.query(sql, params);
    inserted += batch.length;
    
    if (inserted % 10000 === 0 || i + BATCH >= active.length) {
      process.stdout.write(`\r Progress: ${inserted}/${active.length} (${Math.round(inserted/active.length*100)}%)`);
    }
  }

  const after = await pool.query('SELECT COUNT(*) FROM medicines');
  console.log(`\n\n✅ Done! Total medicines in DB: ${after.rows[0].count}`);
  await pool.end();
}

run().catch(err => { console.error('Error:', err.message); process.exit(1); });
