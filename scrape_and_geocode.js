const fs = require('fs');

const BASE_URL = "https://gshrealestate.com/properties/";
const OUTPUT_FILE = "properties.json";

// Headers to mimic a real browser to avoid 403 Forbidden
const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0"
};

async function fetchText(url) {
    try {
        const response = await fetch(url, { headers: HEADERS });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.text();
    } catch (error) {
        console.error(`Error fetching ${url}:`, error.message);
        return null;
    }
}

function extractByRegex(html, regex) {
    const match = html.match(regex);
    return match ? match[1] : null;
}

async function geocodeAddress(query) {
    try {
        const url_encoded = encodeURIComponent(query);
        const url = `https://nominatim.openstreetmap.org/search?q=${url_encoded}&format=json&limit=1`;
        const headers = { 'User-Agent': 'GSHPropertyMapper/1.0' }; // Required by Nominatim

        await new Promise(r => setTimeout(r, 1000)); // Rate limit 1s

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
    console.log("Starting scrape...");
    const mainPageHtml = await fetchText(BASE_URL);
    if (!mainPageHtml) return;

    // Regex to find property links
    // Focusing on the structure seen: <a href="https://gshrealestate.com/portfolio/..." ...>
    const linkRegex = /<a href="(https:\/\/gshrealestate\.com\/portfolio\/[^"]+)"/g;
    const links = [...mainPageHtml.matchAll(linkRegex)].map(m => m[1]);

    // Deduplicate
    const uniqueLinks = [...new Set(links)];
    console.log(`Found ${uniqueLinks.length} property links.`);

    const properties = [];

    for (let i = 0; i < uniqueLinks.length; i++) {
        const url = uniqueLinks[i];
        console.log(`[${i + 1}/${uniqueLinks.length}] scraping ${url}...`);

        const pageHtml = await fetchText(url);
        if (!pageHtml) continue;

        // Extract Data
        let title = extractByRegex(pageHtml, /<meta property="og:title" content="([^"]+)" \/>/);
        if (!title) title = extractByRegex(pageHtml, /<title>(.*?)<\/title>/);
        if (title) title = title.replace(" - GSH Real Estate", "").replace(" &#8211; GSH Real Estate", "");

        const image = extractByRegex(pageHtml, /<meta property="og:image" content="([^"]+)" \/>/);
        const description = extractByRegex(pageHtml, /<meta property="og:description" content="([^"]+)" \/>/);

        // Address Extraction Strategy
        let outputAddress = "Address Not Found";
        let geocodeQuery = "";

        // 1. Look for explicit Location header
        let location = extractByRegex(pageHtml, /<h4>Location:<\/h4>\s*<p>(.*?)<\/p>/);

        // 2. Look for address patterns in description if location missing
        if (!location && description) {
            // Very basic pattern: digits followed by text, comma, state
            const addrMatch = description.match(/\d+\s+[\w\s]+,\s+[\w\s]+,\s+[A-Z]{2}/);
            if (addrMatch) location = addrMatch[0];
        }

        if (location) {
            outputAddress = location;
            geocodeQuery = location;
            // Add state if missing (generic heuristic)
            if (!geocodeQuery.includes(",")) geocodeQuery += ", USA";
        } else {
            // Fallback: Use title + "Apartments" or similar? 
            // Without location, we can't do much. 
            // Try to find state in description?
        }

        // Final fallback for geocoding: Title + ", USA"
        // But better to attempt rigorous geocoding later if valid address found.
        if (outputAddress !== "Address Not Found") {
            // Clean up address (remove HTML entities if any)
            outputAddress = outputAddress.replace(/&#\d+;/g, "");
            geocodeQuery = outputAddress;
        } else {
            // Heuristic: Many titles follow "The Meadows at [City]" format
            if (title.includes(" at ")) {
                geocodeQuery = title.split(" at ")[1] + ", USA"; // Try city
            }
        }

        // Refined Geocoding logic based on previous learnings:
        // Use Title + City/State if available for better accuracy
        if (title && outputAddress !== "Address Not Found") {
            geocodeQuery = `${title}, ${outputAddress}`;
        } else if (outputAddress !== "Address Not Found") {
            geocodeQuery = outputAddress;
        } else {
            // Last resort
            geocodeQuery = title;
        }

        console.log(`Geocoding query: "${geocodeQuery}"`);
        let coords = { lat: null, lon: null };
        if (geocodeQuery) {
            coords = await geocodeAddress(geocodeQuery);
            // If failed and we used specific address, try just City/State from location if available
            if (!coords.lat && location) {
                console.log("Retrying geocode with location only...");
                coords = await geocodeAddress(location);
            }
        }

        properties.push({
            title,
            url,
            image,
            description,
            address: outputAddress,
            location_field: location,
            lat: coords.lat,
            lon: coords.lon
        });

        // Polite delay
        await new Promise(r => setTimeout(r, 500));
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(properties, null, 2));
    console.log(`Saved ${properties.length} properties to ${OUTPUT_FILE}`);

})();
