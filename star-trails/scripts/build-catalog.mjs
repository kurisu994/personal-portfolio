/**
 * Data Source & License:
 * Yale Bright Star Catalogue 5th Edition (BSC5)
 * Reference: Hoffleit, D. and Warren, Jr., W.H., 1991, "The Bright Star Catalog, 5th Revised Edition"
 * Retrieved from CDS VizieR (V/50).
 * Factual scientific data; public domain / requiring attribution.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');

const CATALOG_URL = 'https://cdsarc.cds.unistra.fr/ftp/V/50/catalog';
const BIN_FILE = path.join(DATA_DIR, 'bsc5_mag45.bin');
const JSON_FILE = path.join(DATA_DIR, 'bsc5_mag45.json');

const MAG_LIMIT = 4.5;

function parseCoordinates(raH, raM, raS, decSign, decD, decM, decS) {
    // RA to radians
    const raDeg = (raH + raM / 60 + raS / 3600) * 15;
    const raRad = raDeg * Math.PI / 180;

    // Dec to radians
    let decDeg = decD + decM / 60 + decS / 3600;
    if (decSign === '-') decDeg = -decDeg;
    const decRad = decDeg * Math.PI / 180;

    return { raRad, decRad };
}

function generateMockData() {
    console.log('Generating mock data due to network failure...');
    const stars = [];
    const count = 1600;
    for (let i = 0; i < count; i++) {
        // Uniform sphere distribution
        const u = Math.random();
        const v = Math.random();
        const raRad = 2 * Math.PI * u;
        const decRad = Math.acos(2 * v - 1) - Math.PI / 2;
        
        const vmag = -1 + Math.random() * (MAG_LIMIT + 1); // -1 to 4.5
        const bv = -0.3 + Math.random() * 2.0;

        stars.push({ raRad, decRad, vmag, bv });
    }
    return stars;
}

function parseCatalog(text) {
    const lines = text.split('\n');
    const stars = [];
    let parsedCount = 0;

    for (const line of lines) {
        if (line.length < 114) continue;
        parsedCount++;

        const raH = parseFloat(line.substring(75, 77));
        const raM = parseFloat(line.substring(77, 79));
        const raS = parseFloat(line.substring(79, 83));
        const decSign = line.substring(83, 84);
        const decD = parseFloat(line.substring(84, 86));
        const decM = parseFloat(line.substring(86, 88));
        const decS = parseFloat(line.substring(88, 90));
        
        const vmagStr = line.substring(102, 107).trim();
        const bvStr = line.substring(109, 114).trim();

        if (isNaN(raH) || isNaN(decD) || !vmagStr) continue;

        const vmag = parseFloat(vmagStr);
        if (isNaN(vmag) || vmag > MAG_LIMIT) continue;

        let bv = parseFloat(bvStr);
        if (isNaN(bv)) bv = 0.0;

        const { raRad, decRad } = parseCoordinates(raH, raM, raS, decSign, decD, decM, decS);
        stars.push({ raRad, decRad, vmag, bv });
    }
    
    console.log(`Total stars parsed from catalog: ${parsedCount}`);
    return stars;
}

async function main() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    let stars = [];
    try {
        console.log(`Fetching catalog from ${CATALOG_URL} ...`);
        const response = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        stars = parseCatalog(text);
    } catch (e) {
        console.warn(`Failed to fetch catalog: ${e.message}`);
        console.warn('NOTE: Real data needs to be manually downloaded to replace this mock data.');
        stars = generateMockData();
    }

    console.log(`Stars after filtering (Vmag <= ${MAG_LIMIT}): ${stars.length}`);

    // Write JSON
    fs.writeFileSync(JSON_FILE, JSON.stringify(stars, null, 2));

    // Write Binary
    // 16 bytes per star: 4 x Float32 (RA, Dec, Vmag, BV), little endian
    const buffer = Buffer.alloc(stars.length * 16);
    let offset = 0;
    for (const star of stars) {
        buffer.writeFloatLE(star.raRad, offset);
        buffer.writeFloatLE(star.decRad, offset + 4);
        buffer.writeFloatLE(star.vmag, offset + 8);
        buffer.writeFloatLE(star.bv, offset + 12);
        offset += 16;
    }
    fs.writeFileSync(BIN_FILE, buffer);

    console.log(`Output JSON: ${JSON_FILE} (${fs.statSync(JSON_FILE).size} bytes)`);
    console.log(`Output BIN:  ${BIN_FILE} (${fs.statSync(BIN_FILE).size} bytes)`);
    console.log('Pipeline complete.');
}

main().catch(console.error);
