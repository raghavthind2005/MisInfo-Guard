/**
 * Sources we are willing to show as evidence. Search is restricted to these,
 * so which outlets count as trustworthy is our decision and never the model's.
 */
export const TRUSTED_DOMAINS = [
    // Wire services and broadcasters
    'reuters.com', 'apnews.com', 'afp.com', 'bbc.com', 'bbc.co.uk', 'npr.org', 'pbs.org',
    'cnbc.com', 'bloomberg.com',
    // Newspapers of record
    'nytimes.com', 'washingtonpost.com', 'wsj.com', 'theguardian.com', 'ft.com',
    'thehindu.com', 'indianexpress.com',
    // Fact-checkers
    'snopes.com', 'politifact.com', 'factcheck.org', 'fullfact.org', 'factcheck.afp.com',
    'factly.in', 'boomlive.in', 'altnews.in', 'leadstories.com',
    // Reference and official science sources
    'britannica.com', 'wikipedia.org', 'nasa.gov', 'noaa.gov', 'who.int', 'cdc.gov',
    'nih.gov', 'un.org', 'worldbank.org', 'ourworldindata.org', 'nature.com',
];
