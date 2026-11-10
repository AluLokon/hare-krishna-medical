// enrich_medicines2.js
// Run from project root: node enrich_medicines2.js
// Requires medicine_details.json in same folder

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  console.log('Step 1: Adding columns to medicines table...');
  await pool.query(`ALTER TABLE medicines ADD COLUMN IF NOT EXISTS uses TEXT`);
  await pool.query(`ALTER TABLE medicines ADD COLUMN IF NOT EXISTS composition TEXT`);
  await pool.query(`ALTER TABLE medicines ADD COLUMN IF NOT EXISTS side_effects TEXT`);
  console.log('✅ Columns ready');

  console.log('\nStep 2: Loading medicine_details.json...');
  const records = JSON.parse(fs.readFileSync('medicine_details.json', 'utf8'));
  console.log(`✅ Loaded ${records.length} records`);

  console.log('\nStep 3: Matching and updating database...');
  let updated = 0;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (!rec.name) continue;

    const uses = (rec.uses || '').replace(/<[^>]*>/g, '').trim();
    const composition = (rec.composition || '').trim();
    const sideEffects = (rec.side_effects || '').replace(/<[^>]*>/g, '').trim();

    if (!uses && !composition) continue;

    // Exact name match
    const result = await pool.query(
      `UPDATE medicines SET uses = $1, composition = $2, side_effects = $3
       WHERE lower(name) = lower($4) AND (uses IS NULL OR uses = '')
       RETURNING id`,
      [uses, composition, sideEffects, rec.name.trim()]
    );

    if (result.rowCount > 0) {
      updated += result.rowCount;
    }

    if ((i + 1) % 500 === 0) {
      console.log(`  Progress: ${i + 1}/${records.length} processed, ${updated} updated`);
    }
  }

  console.log(`\n✅ Done! Updated ${updated} medicines with uses/composition/side_effects`);

  const sample = await pool.query(
    `SELECT name, uses, composition FROM medicines WHERE uses IS NOT NULL AND uses != '' LIMIT 3`
  );
  console.log('\nSample:');
  sample.rows.forEach(r => {
    console.log(`\n📌 ${r.name}`);
    console.log(`   Uses: ${(r.uses || '').substring(0, 100)}`);
    console.log(`   Composition: ${(r.composition || '').substring(0, 80)}`);
  });

  await pool.end();
}

main().catch(console.error);
