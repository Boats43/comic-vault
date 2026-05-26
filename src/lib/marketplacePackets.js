// Marketplace Listing Packet Generator
// Generates copy-ready listing packets for channels without full API automation:
// Mercari, Facebook Marketplace, Craigslist, Whatnot

// Helper: sanitize title to canonical form (no noise)
const sanitizeTitle = (title) => {
  if (!title) return '';
  return String(title).trim();
};

// Helper: format grade for display
const formatGrade = (item) => {
  if (item.isGraded === true && item.numericGrade != null) {
    return `CGC ${item.numericGrade}`;
  }
  return item.grade || 'Raw';
};

// Helper: check if key issue should be displayed
const showKeyIssue = (k) => {
  if (!k) return false;
  const s = k.toLowerCase().trim();
  if (['no', 'n/a', 'none', 'false', 'not a key', 'non-key', 'non key', 'not key']
    .some((x) => s.includes(x))) return false;
  return s.length > 2;
};

// Helper: abbreviate title for Whatnot (60 char limit)
const abbreviateTitle = (title) => {
  const abbrs = {
    'Amazing Spider-Man': 'ASM',
    'Spectacular Spider-Man': 'PPSM',
    'Uncanny X-Men': 'UXM',
    'Incredible Hulk': 'IH',
    'Detective Comics': 'Detective',
    'Action Comics': 'Action',
    'Fantastic Four': 'FF',
    'Avengers': 'Avengers',
    'Iron Man': 'IM',
    'Captain America': 'Cap',
    'Thor': 'Thor',
    'Daredevil': 'DD',
    'Wolverine': 'Wolvie'
  };

  for (const [full, abbr] of Object.entries(abbrs)) {
    if (title.includes(full)) return title.replace(full, abbr);
  }
  return title;
};

// Helper: truncate to max length, break at word boundary
const truncate = (str, maxLen) => {
  if (!str || str.length <= maxLen) return str;
  const trimmed = str.substring(0, maxLen);
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace > maxLen * 0.7) return trimmed.substring(0, lastSpace);
  return trimmed;
};

// ============================================================
// TITLE GENERATORS
// ============================================================

// Mercari: 40 char max
// Format: [Title] #[Issue] [Grade] [Year]
export const getMercariTitle = (item) => {
  const title = sanitizeTitle(item.title);
  const issue = item.issue ? `#${item.issue}` : '';
  const grade = formatGrade(item);
  const year = item.year || '';

  const parts = [title, issue, grade, year].filter(Boolean);
  const joined = parts.join(' ');
  return truncate(joined, 40);
};

// Facebook: 100 char max
// Format: [Title] #[Issue] ([Year]) [Grade] - [Key note if any]
export const getFacebookTitle = (item) => {
  const title = sanitizeTitle(item.title);
  const issue = item.issue ? `#${item.issue}` : '';
  const year = item.year ? `(${item.year})` : '';
  const grade = formatGrade(item);
  const keyNote = showKeyIssue(item.keyIssue) ? `- ${item.keyIssue}` : '';

  const parts = [title, issue, year, grade, keyNote].filter(Boolean);
  const joined = parts.join(' ');
  return truncate(joined, 100);
};

// Craigslist: 70 char max
// Format: [Title] #[Issue] [Year] Comic [Grade]
export const getCraigslistTitle = (item) => {
  const title = sanitizeTitle(item.title);
  const issue = item.issue ? `#${item.issue}` : '';
  const year = item.year || '';
  const grade = formatGrade(item);

  const parts = [title, issue, year, 'Comic', grade].filter(Boolean);
  const joined = parts.join(' ');
  return truncate(joined, 70);
};

// Whatnot: 60 char max
// Format: [Title Abbr] #[Issue] [Grade] [Key note]
export const getWhatnotTitle = (item) => {
  const title = abbreviateTitle(sanitizeTitle(item.title));
  const issue = item.issue ? `#${item.issue}` : '';
  const grade = formatGrade(item);
  const keyNote = showKeyIssue(item.keyIssue)
    ? item.keyIssue.substring(0, 20)
    : '';

  const parts = [title, issue, grade, keyNote].filter(Boolean);
  const joined = parts.join(' ');
  return truncate(joined, 60);
};

// ============================================================
// DESCRIPTION GENERATORS
// ============================================================

// Mercari: Plain text, 2-sentence condition
export const getMercariDescription = (item) => {
  const title = sanitizeTitle(item.title);
  const issue = item.issue ? `#${item.issue}` : '';
  const year = item.year ? `(${item.year})` : '';
  const publisher = item.publisher || '';
  const grade = formatGrade(item);
  const keyNote = showKeyIssue(item.keyIssue) ? `\nKey: ${item.keyIssue}` : '';

  // Condition summary (2 sentences max)
  const condition = item.reason
    ? String(item.reason).split('.').slice(0, 2).join('.') + (item.reason.includes('.') ? '' : '.')
    : 'See photos for condition details.';

  return `${title} ${issue} ${year}
Publisher: ${publisher}
Grade: ${grade}${keyNote}

Condition: ${condition}
Ships in protective bag/board.`.trim();
};

// Facebook: Conversational, "open to offers", local mention
export const getFacebookDescription = (item) => {
  const title = sanitizeTitle(item.title);
  const issue = item.issue ? `#${item.issue}` : '';
  const year = item.year || '';
  const grade = formatGrade(item);
  const keyNote = showKeyIssue(item.keyIssue) ? `\n${item.keyIssue}` : '';

  const condition = item.reason
    ? String(item.reason).split('.').slice(0, 2).join('.') + '.'
    : 'See photos for condition.';

  return `Selling ${title} ${issue} from ${year}.
Grade: ${grade} — ${condition}${keyNote}

Ships or local pickup Phoenix area.
Open to reasonable offers.`.trim();
};

// Craigslist: Minimal, firm/OBO
export const getCraigslistDescription = (item) => {
  const title = sanitizeTitle(item.title);
  const issue = item.issue ? `#${item.issue}` : '';
  const year = item.year || '';
  const grade = formatGrade(item);
  const keyNote = showKeyIssue(item.keyIssue) ? `\n${item.keyIssue}` : '';

  return `${title} ${issue} ${year}
Grade: ${grade}${keyNote}

Will ship or meet locally.`.trim();
};

// Whatnot: Emoji-friendly, starting bid, 1-sentence condition
export const getWhatnotDescription = (item) => {
  const title = sanitizeTitle(item.title);
  const issue = item.issue ? `#${item.issue}` : '';
  const grade = formatGrade(item);
  const keyNote = showKeyIssue(item.keyIssue) ? `\n${item.keyIssue}` : '';
  const year = item.year || '';
  const publisher = item.publisher || '';

  const condition = item.reason
    ? String(item.reason).split('.')[0] + '.'
    : 'See photos.';

  return `🔥 ${title} ${issue} — ${grade}${keyNote}
${year} | ${publisher}

${condition}`.trim();
};

// ============================================================
// WHATNOT STARTING BID CALCULATOR
// ============================================================

export const getWhatnotStartingBid = (item, getDisplayPrice) => {
  const price = getDisplayPrice(item);
  if (!price || price === 0) return { startingBid: 1, warning: null };

  const startingBid = Math.max(1, Math.round(price * 0.7));

  // Floor warning (display-only, no price mutation)
  // Only show if floor exists on item
  const floor = item.rawComps?.lowest || null;
  const warning = floor && startingBid < floor
    ? `Below floor ($${floor.toFixed(2)})`
    : null;

  return { startingBid, warning };
};

// ============================================================
// MAIN PACKET GENERATOR
// ============================================================

export const generatePacket = (item, channel, getDisplayPrice, getComicPhotos) => {
  // Eligibility checks
  if (item.decision?.action === 'DO_NOT_LIST') {
    return {
      error: 'DO_NOT_LIST',
      reason: 'Blocked by decision engine'
    };
  }

  if (item.decision?.action === 'ID_REQUIRED') {
    return {
      error: 'ID_REQUIRED',
      reason: 'Identity verification required'
    };
  }

  if ((item.decision?.blockers?.length || 0) > 0) {
    return {
      error: 'BLOCKED',
      reason: `Has decision blockers: ${item.decision.blockers.join(', ')}`
    };
  }

  if (item.status === 'sold') {
    return {
      error: 'SOLD',
      reason: 'Item already sold'
    };
  }

  if (getDisplayPrice(item) === 0) {
    return {
      error: 'NO_PRICE',
      reason: 'No price available'
    };
  }

  if (item.decision?.bestChannel === 'research') {
    const researchReason = item.decision?.warnings?.[0] || 'Marked for research';
    return {
      error: 'RESEARCH',
      reason: researchReason
    };
  }

  // Title generator selector
  const titleGenerators = {
    mercari: getMercariTitle,
    facebook: getFacebookTitle,
    craigslist: getCraigslistTitle,
    whatnot: getWhatnotTitle
  };

  // Description generator selector
  const descriptionGenerators = {
    mercari: getMercariDescription,
    facebook: getFacebookDescription,
    craigslist: getCraigslistDescription,
    whatnot: getWhatnotDescription
  };

  const titleFn = titleGenerators[channel];
  const descFn = descriptionGenerators[channel];

  if (!titleFn || !descFn) {
    return {
      error: 'INVALID_CHANNEL',
      reason: `Unknown channel: ${channel}`
    };
  }

  const price = getDisplayPrice(item);
  const photos = getComicPhotos(item);

  // Build base packet
  const packet = {
    sourceType: 'single',
    assetIds: [item.id],
    channel,
    title: titleFn(item),
    description: descFn(item),
    price,
    photos,
    tags: [item.publisher, item.year, item.keyIssue].filter(Boolean),
    warnings: [],
    requiresApproval: true,
    createdAt: Date.now()
  };

  // Add warning for already-listed items
  if (item.status === 'listed') {
    packet.warnings.push('Already listed on eBay');
  }

  // Add Whatnot-specific fields
  if (channel === 'whatnot') {
    const { startingBid, warning } = getWhatnotStartingBid(item, getDisplayPrice);
    packet.startingBid = startingBid;
    if (warning) packet.warnings.push(warning);
  }

  return packet;
};
