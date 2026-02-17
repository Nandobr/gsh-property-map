const fs = require('fs');

const INPUT_FILE = "properties.json"; // Expects the output from scrape_and_geocode.js
const OUTPUT_FILE = "properties_final.json";

// Map of state abbreviations to full names for better geocoding accuracy
const STATE_MAP = {
    "MI": "Michigan",
    "IN": "Indiana",
    "OH": "Ohio",
    "FL": "Florida",
    "MA": "Massachusetts",
    "MD": "Maryland",
    "USA": "USA"
};

async function geocodeAddress(query) {
    if (!query) return { lat: null, lon: null };

    // Expand state abbreviations if present at the end
    // e.g. "Canton, MI" -> "Canton, Michigan"
    for (const [abbr, full] of Object.entries(STATE_MAP)) {
        if (query.endsWith(` ${abbr}`)) {
            query = query.replace(` ${abbr}`, ` ${full}`);
            break;
        }
    }

    console.log(`Geocoding: "${query}"`);
    try {
        const url_encoded = encodeURIComponent(query);
        const url = `https://nominatim.openstreetmap.org/search?q=${url_encoded}&format=json&limit=1`;
        const headers = { 'User-Agent': 'GSHPropertyMapper/1.1' };

        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error(`Geocode error: ${response.status}`);

        const data = await response.json();
        if (data && data.length > 0) {
            return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
        }
    } catch (error) {
        console.error(`Geocoding failed for "${query}":`, error.message);
    }
    return { lat: null, lon: null };
}

(async () => {
    if (!fs.existsSync(INPUT_FILE)) {
        console.error("Input file not found!");
        return;
    }
    const raw = fs.readFileSync(INPUT_FILE);
    let properties = JSON.parse(raw);

    let updatedCount = 0;

    for (const p of properties) {
        let needsUpdate = false;

        // 1. Check for missing coordinates
        if (p.lat === null || p.lon === null) {
            needsUpdate = true;
        }
        // 2. Check for suspicious coordinates (e.g., Canton, MI resolving to Mississippi)
        // Canton, MI is approx lat 42. MS is approx 32.
        else if (p.address.includes(", MI") && p.lat < 41) {
            console.log(`Fixing suspicious coordinate for ${p.title} (${p.lat})`);
            needsUpdate = true;
        }

        if (needsUpdate) {
            // Try different query strategies
            let queries = [];

            // Strategy A: Title + City + State (if available in address)
            // Strategy B: Just Address (City, State) with State expansion
            // Strategy C: Title only (fallback)

            if (p.address && p.address !== "Address Not Found") {
                queries.push(p.address + ", USA"); // Add country context
                if (p.title) queries.push(`${p.title}, ${p.address}, USA`);
            }
            if (p.title) {
                queries.push(p.title + ", USA");
            }

            let found = false;
            for (const q of queries) {
                const coords = await geocodeAddress(q);
                if (coords.lat) {
                    // Sanity check for Michigan if applicable
                    if (q.includes("Michigan") && coords.lat < 41) {
                        console.log(`  -> Ignored suspicious result for ${q}: ${coords.lat}`);
                        continue;
                    }

                    p.lat = coords.lat;
                    p.lon = coords.lon;
                    updatedCount++;
                    found = true;
                    console.log(`  -> Resolved: ${p.title} at ${coords.lat}, ${coords.lon}`);
                    break;
                }
                await new Promise(r => setTimeout(r, 1000));
            }

            if (!found) {
                console.log(`  -> FAILED to resolve ${p.title}`);
            }
        }
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(properties, null, 2));
    console.log(`Updated ${updatedCount} properties. Saved to ${OUTPUT_FILE}`);
})();
