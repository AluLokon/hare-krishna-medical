// enrich_medicines.js
// Run from project root: node enrich_medicines.js
// Downloads indian-medicines dataset from HuggingFace and adds uses/composition to your DB

require('dotenv').config();
const { Pool } = require('pg');
const https = require('https');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Step 1: Download parquet file from HuggingFace
async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        // Follow redirect
        https.get(res.headers.location, (res2) => {
          res2.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        }).on('error', reject);
      } else {
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }
    }).on('error', reject);
  });
}

async function main() {
  console.log('Step 1: Adding columns to medicines table...');

  try {
    await pool.query(`ALTER TABLE medicines ADD COLUMN IF NOT EXISTS uses TEXT`);
    await pool.query(`ALTER TABLE medicines ADD COLUMN IF NOT EXISTS composition TEXT`);
    await pool.query(`ALTER TABLE medicines ADD COLUMN IF NOT EXISTS side_effects TEXT`);
    console.log('✅ Columns added (uses, composition, side_effects)');
  } catch (err) {
    console.error('Column error:', err.message);
  }

  console.log('\nStep 2: Downloading dataset from HuggingFace...');

  // HuggingFace parquet URL for this dataset
  const parquetUrl = 'https://huggingface.co/datasets/dmedhi/indian-medicines/resolve/main/data/train-00000-of-00001.parquet';
  const parquetPath = path.join(__dirname, 'medicine_details.parquet');

  try {
    await downloadFile(parquetUrl, parquetPath);
    console.log('✅ Downloaded parquet file');
  } catch (err) {
    console.error('Download failed:', err.message);
    console.log('\nPlease download manually:');
    console.log('1. Go to: https://huggingface.co/datasets/dmedhi/indian-medicines/tree/main/data');
    console.log('2. Download the .parquet file');
    console.log('3. Save it as medicine_details.parquet in your project root');
    console.log('4. Run: node enrich_medicines.js --skip-download');
    process.exit(1);
  }

  console.log('\nStep 3: Reading and matching medicines...');

  // Use Python to read parquet (Node doesn't have good parquet support)
  // We'll convert to JSON first using Python
  const { execSync } = require('child_process');

  try {
    execSync(`python3 -c "
import pandas as pd, json
df = pd.read_parquet('medicine_details.parquet')
df = df.fillna('')
records = df[['name','composition','uses','side_effects']].to_dict('records')
with open('medicine_details.json','w') as f:
    json.dump(records, f)
print(f'Converted {len(records)} records')
"`, { stdio: 'inherit' });
  } catch (err) {
    console.error('Python conversion failed. Install pandas: pip install pandas pyarrow');
    process.exit(1);
  }

  const records = JSON.parse(fs.readFileSync('medicine_details.json', 'utf8'));
  console.log(`✅ Loaded ${records.length} medicine records`);

  console.log('\nStep 4: Matching and updating database...');

  let updated = 0;
  let notFound = 0;

  for (const rec of records) {
    if (!rec.name) continue;

    // Clean up uses text — remove HTML tags if any
    const uses = (rec.uses || '').replace(/<[^>]*>/g, '').trim();
    const composition = (rec.composition || '').trim();
    const sideEffects = (rec.side_effects || '').replace(/<[^>]*>/g, '').trim();

    if (!uses && !composition) continue;

    // Try exact match first, then fuzzy
    const result = await pool.query(
      `UPDATE medicines
       SET uses = $1, composition = $2, side_effects = $3
       WHERE lower(name) = lower($4) AND (uses IS NULL OR uses = '')
       RETURNING id`,
      [uses, composition, sideEffects, rec.name.trim()]
    );

    if (result.rowCount > 0) {
      updated++;
    } else {
      // Try partial match (name contains)
      const result2 = await pool.query(
        `UPDATE medicines
         SET uses = $1, composition = $2, side_effects = $3
         WHERE lower(name) LIKE lower($4) AND (uses IS NULL OR uses = '')
         RETURNING id`,
        [uses, composition, sideEffects, `%${rec.name.trim().split(' ')[0]}%`]
      );
      if (result2.rowCount > 0) {
        updated += result2.rowCount;
      } else {
        notFound++;
      }
    }
  }

  console.log(`\n✅ Done!`);
  console.log(`   Updated: ${updated} medicines with uses/composition`);
  console.log(`   Not matched: ${notFound} records`);

  // Show sample
  const sample = await pool.query(
    `SELECT name, uses, composition FROM medicines WHERE uses IS NOT NULL AND uses != '' LIMIT 3`
  );
  console.log('\nSample updated medicines:');
  sample.rows.forEach(r => {
    console.log(`\n📌 ${r.name}`);
    console.log(`   Uses: ${r.uses?.substring(0, 100)}...`);
    console.log(`   Composition: ${r.composition?.substring(0, 80)}...`);
  });

  // Cleanup
  fs.unlinkSync('medicine_details.json');

  await pool.end();
  console.log('\n🎉 All done! Now update your website to show uses on medicine cards.');
}

main().catch(console.error);
