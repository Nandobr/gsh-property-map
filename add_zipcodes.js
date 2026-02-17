const fs = require('fs');

const INPUT_FILE = "properties_final.json";
const OUTPUT_FILE = "properties_final.json"; // Overwrite the final file

async function reverseGeocode(lat, lon) {
    if (!lat || !lon) return null;
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
        const headers = { 'User-Agent': 'GSHPropertyMapper/1.2' }; // Good practice to use distinct User-Agent

        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();
        if (data && data.address && data.address.postcode) {
            return data.address.postcode;
        }
    } catch (error) {
        console.error(`Error reverse geocoding ${lat}, ${lon}:`, error.message);
    }
    return null;
}

(async () => {
    const raw = fs.readFileSync(INPUT_FILE);
    const properties = JSON.parse(raw);

    console.log(`Processing ${properties.length} properties...`);
    let updatedCount = 0;

    for (const p of properties) {
        // Skip if already has zip code (unless we want to force update)
        if (!p.zip_code && p.lat && p.lon) {
            console.log(`Fetching zip for ${p.title}...`);
            const zip = await reverseGeocode(p.lat, p.lon);
            if (zip) {
                p.zip_code = zip;
                p.address = `${p.address} ${zip}`; // Append zip to address for display
                console.log(`  -> Found: ${zip}`);
                updatedCount++;
            } else {
                console.log(`  -> No zip found.`);
            }
            // Rate limiting
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(properties, null, 2));
    console.log(`Updated ${updatedCount} properties with zip codes.`);
})();
