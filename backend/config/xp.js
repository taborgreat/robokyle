/* ============================================================
   XP system: the single source of truth for every constant.
   Spec: "XP numbers are tuned for feel, not tested" — everything
   here is meant to be retuned without touching engine code.
   ============================================================ */

// Generic display bands; Ability and Innovation carry the spec's named tracks.
const GENERIC_TITLES = [
  [1, 'Novice'], [10, 'Apprentice'], [20, 'Journeyman'],
  [30, 'Craftsman'], [40, 'Expert'], [50, 'Master'],
];

/* F12: category ids are immutable, forever. Rename display names freely;
   never reuse or retire an id — history is keyed on them. */
const categories = [
  /* scope is the §1 registry line, rendered verbatim in the skill-grid tooltip
     so what a category "is" can never drift from what it counts.
     color is the category's one design token: grid, ring, chips and ledger all
     read it from here. Muted on purpose — category colors are the only
     saturation on the page. */
  { id: 'mech',  name: 'Mechanical',    icon: '🛠️', color: '#B98A52', hidden: false,
    scope: 'CAD, mechanisms, linkages, structural design, prosthetic geometry', titles: GENERIC_TITLES },
  { id: 'fab',   name: 'Fabrication',   icon: '🖨️', color: '#7C9E80', hidden: false,
    scope: 'FDM/resin printing, CNC, laser, casting, machining', titles: GENERIC_TITLES },
  { id: 'elec',  name: 'Electronics',   icon: '⚡', color: '#C4A23A', hidden: false,
    scope: 'Circuits, PCBs, sensors, motors, power', titles: GENERIC_TITLES },
  { id: 'soft',  name: 'Software',      icon: '💻', color: '#6E8FBF', hidden: false,
    scope: 'Apps, firmware, APIs, control software, simulation, software for hardware that exists or is still coming', titles: GENERIC_TITLES },
  { id: 'sys',   name: 'Systems',       icon: '🔧', color: '#8B7FA8', hidden: false,
    scope: 'Integration, hardware-software bridges, control, calibration, making sub-works cooperate', titles: GENERIC_TITLES },
  { id: 'abil',  name: 'Ability',       icon: '🦾', color: '#4E9E9E', hidden: false,
    scope: 'Human factors, fit, donning, real-user testing, accessibility review', titles: [
      [1, 'Helper'], [10, 'Fitter'], [20, 'Adapter'],
      [30, 'Ability Engineer'], [40, 'Advocate'], [50, 'Life Changer'],
    ] },
  { id: 'docs',  name: 'Documentation', icon: '📐', color: '#A98F6F', hidden: false,
    scope: 'Guides, BOMs, diagrams, standards authorship, doc revisions on any work', titles: GENERIC_TITLES },
  { id: 'dsgn',  name: 'Design',        icon: '🎨', color: '#BC7E8C', hidden: false,
    scope: 'Industrial design, UX, aesthetics, branding', titles: GENERIC_TITLES },
  { id: 'comm',  name: 'Community',     icon: '🤝', color: '#8CA04A', hidden: false,
    scope: 'Mentoring, moderation, Q&A, review', titles: GENERIC_TITLES },
  // Derived only: never earnable by direct action. No numeric level, aura tiers only.
  { id: 'innov', name: 'Innovation',    icon: '⭐', color: '#C9A648', hidden: true,
    scope: 'Real-world impact of your ideas: builds, references and adoption of your works', titles: [] },
];

module.exports = {
  categories,
  categoryIds: categories.map(c => c.id),
  visibleCategoryIds: categories.filter(c => !c.hidden).map(c => c.id),

  // Work declaration: integer weights summing to 100. §2A says 1–3 categories
  // but the spec's own worked example (§3) declares four, so max is 4 until
  // Tabor rules; it is one constant either way.
  declaration: { min: 1, max: 4, sum: 100 },
  // Composite works gain sys weight per distinct referenced work, then renormalize.
  composite: { perReference: 0.1, cap: 0.5 },

  // §3 amounts. XP is not stored as events: it is recomputed from the works,
  // votes and references themselves, so removing the source removes the XP.
  // Rules for features that do not exist yet (builds, doc revisions, standards,
  // forum, moderation) keep their constants here for when they land.
  amounts: {
    publishOriginal: 100,        // E1: new work (novelty-checked)
    publishDerived: 25,          // publishing a fork / near-duplicate
    version: 25,                 // E2: per released version
    vote: 10,                    // E3/E4: × voter weight, sign by direction
    referenceSplit: 25,          // E7: to the referenced author, by weights
    referenceInnov: 50,          // E7: innovation portion
    buildBuilder: 100,           // E5 (live: verified Produced entry, to the poster)
    buildAbilBonus: 20,          // E5 rider when the report includes fit findings
    buildAuthorInnov: 80,        // E6 (live; F6: × min(1, posterTotalXp/builderCredibilityXp))
    buildAuthorSplit: 40,        // E6 (live)
    docRevision: 60,             // E8 (live; F5: on your OWN work always 0)
    docRevisionComm: 10,         // E8's community half
    // E9 (live): a work's `provides` declaration against your standard is
    // verified. Ports Spec §2 — per unique complying work, once; self earns 0.
    standardComplianceInnov: 30,
    standardComplianceDocs: 30,
    acceptedAnswer: 40,          // E10 (live: Talk accepted answers → comm; F2 cap below)
    fitReport: 100,              // E11 (live: verified usage entry, to the reviewer)
    fitAuthorInnov: 30,          // E11's author side, × the reviewer-credibility multiplier
    moderation: 10,              // E12 (live: mod action upheld past the ratify window)
  },

  /* F3: a work's upvotes emit full XP early and damp as the audience grows, so
     a 2027 level and a 2031 level cost about the same. Vote COUNTS display in
     full; only the XP damps. [max votes at this tier, multiplier] */
  voteDamping: [
    [50, 1], [200, 0.5], [1000, 0.25], [Infinity, 0.1],
  ],

  /* F4: a reference pays its target only once the referencing work proves it
     is alive — net weighted votes at or above this bar. Junk works referencing
     real ones emit nothing; the XP waits for liveness, then fires (which a
     recompute gives us for free). */
  referenceLiveness: { minNetVotes: 5 },

  /* F6: author-side build XP scales with the poster's own standing, so
     alt-farm builds pay a fraction until the builder proves out. */
  builderCredibilityXp: 500,

  /* Produced (Part II): the proof layer. Entries display immediately but emit
     nothing until the §6 gates pass — poster standing, no duplicate media, and
     the challenge window closing clean. Failure reports are first-class: E5
     fires for a documented failure, E6 never does. */
  produced: {
    minAgeHours: 72,             // poster gate: account age…
    minXp: 100,                  //   …or total XP, whichever passes first
    challengeWindowHours: 48,    // entries verify after this, unless challenged
    challengeMinLevel: 10,       // level (entry's category) needed to challenge
    perDay: 5,                   // E5 entries past this per poster per UTC day earn 0 (F2)
    usagePerDay: 4,              // E11 cap (F2)
    modifiedAuthorFactor: 0.5,   // E6 at half when the build needed intervention
    linkCheckDays: 7,            // deployment liveness re-ping cadence
    maxMedia: 5,                 // photos per entry
  },

  /* Doc revisions (Part I §5): docs travel with the work, doc skill is
     portable across works. Community acceptance is docs-expertise weighted. */
  docRevisions: {
    perDay: 5,                   // E8 acceptances past this per UTC day earn 0
    smallDiffChars: 200,         // under this much substantive change…
    smallDiffFactor: 0.5,        //   …E8 pays half
    communityAcceptNet: 15,      // net docs-weighted approval to accept without the author
    authorWindowHours: 72,       // the author's veto window before community acceptance
  },

  /* Moderation ratification (E12): a mod action earns only once it has stood
     unoverturned past the window — the pay is for judgment that held up. */
  moderationRatify: {
    days: 7,
    perDay: 10,
  },

  /* Intro XP: the one self-action that pays, and it pays once. A real bio
     earns a first receipt into Community — derived from the bio existing, so
     deleting it takes the XP back — and the amount sits deliberately below
     every power threshold: no level, no vote weight, no gate unlocked, and
     the new-user ring stays on. It moves the bar; it buys nothing. Daily or
     repeatable versions are §7.1-banned (login rewards) — do not add them. */
  intro: {
    bioAmount: 10,
    bioMinChars: 20,             // "." is not introducing yourself
  },

  /* Ring detection (§8.3): the nightly job's thresholds. Findings are flags
     for review, never automatic punishment — voiding stays a human act. */
  rings: {
    pairLifetimeXp: 500,         // mutual-benefit XP between a pair before it flags
    clusterMinSize: 3,           // strongly-connected clusters this size and up…
    clusterMaxSize: 8,           //   …to this size are candidate rings
    clusterInternalRatio: 0.8,   // exchanging this share of their XP internally flags
    burstWindowHours: 24,        // votes on one target from accounts created within…
    burstMinVotes: 5,            //   …one window, at or past this count, flags
  },

  /* Downvote accountability: a downvote is a claim, the claim is judged, and
     the judgment moves XP. Reason-votes are terminal — they take no reason and
     cannot be voted on, structurally. */
  accountability: {
    reasonMinLength: 10,
    endorseNet: 15,   endorseQuorum: 3,   // net weighted score / distinct voters
    strikeNet: -15,   strikeQuorum: 5,
    stateFreezeDays: 30,                  // after this, the card's state is final
    e13Multiplier: 2,                     // struck: downvoter loses 2× the voided E4
    e14Amount: 15,                        // endorsed: critic earns this into comm
    e14PerDay: 3,
    strikesPerWeekBeforeFlag: 3,          // beyond this, the account is a moderation case
    // §2A miscategorization disputes: standing required to raise one (level in
    // any of the work's declared categories). Admins are exempt.
    disputeMinLevel: 10,
  },

  caps: {
    publishesPerDay: 5,          // publishes past this per UTC day earn 0
    versionsPerWorkPerDay: 3,    // version XP past this per work per UTC day earns 0
    versionsPerDay: 5,           // F7: version XP past this per account per UTC day earns 0
    voterToAuthorLifetime: 500,  // one voter's positive vote XP to one author, ever
    acceptedAnswersPerDay: 6,    // E10 acceptances past this per UTC day earn 0 (F2)
  },

  /* Talk (Talk Spec). Votes there emit zero XP by construction — the ledger
     walk never reads them — so the only constants Talk needs are its clocks. */
  talk: {
    archiveDays: 60,             // threads idle this long go read-only (became-work never does)
    promoteTimeoutDays: 14,      // OP silence on a promotion request stops being a veto after this
  },

  /* Ports (Ports Spec §2): a `provides` claim flips to verified on a review by
     an account with this level in the standard's dominant category. */
  ports: {
    verifyMinLevel: 10,
    maxPerWork: 10,              // provides and accepts each
    maxFieldsPerStandard: 12,    // a standard's machine-readable fields stay flat and small
  },

  // §4 voter_weight(v,c) = clamp(base + perCatLevel×level(v,c) + perTotalLevel×TotalLevel(v), min, max)
  voteWeight: { base: 0.2, perCatLevel: 0.1, perTotalLevel: 0.05, min: 0.2, max: 5.0 },

  // §7 cumulative_xp_required(L) = base × L², capped.
  levelCurve: { base: 75, cap: 99 },

  // RoboXP = workXp × 1.0 + socialXp × socialWeight
  roboXp: { socialWeight: 0.6 },

  // Innovation aura tiers. TUNE: thresholds are not specified in the spec.
  innovationTiers: [
    [1, 'Spark'], [1000, 'Catalyst'], [5000, 'Force Multiplier'], [25000, 'Standard-Bearer'],
  ],
  // Open decision #3 (Tabor): 'hidden-until-earned' or 'greyed'.
  innovationDisplay: 'hidden-until-earned',

  /* §2B need-tag vocabulary v1 (open decision #1, resolved: preset list).
     The human-search layer: what a person or caregiver actually looks for.
     Curated here as the single source of truth; custom tags are still
     accepted so a real need the list missed is never blocked, but the UI
     leads with these. Grouped for the picker. */
  needVocabulary: [
    { group: 'Body & movement', tags: [
      'one-handed', 'left-hand-only', 'limited-grip', 'tremor', 'low-strength',
      'limited-reach', 'seated-use', 'no-fine-motor',
    ] },
    { group: 'Condition', tags: [
      'stroke-recovery', 'arthritis', 'cerebral-palsy', 'spinal-cord-injury',
      'amputation', 'muscular-dystrophy', 'low-vision', 'hearing',
    ] },
    { group: 'Daily task', tags: [
      'feeding', 'drinking', 'dressing', 'hygiene', 'cooking', 'opening-jars',
      'writing', 'typing', 'gaming', 'phone-use', 'carrying', 'door-handles',
    ] },
    { group: 'Where it mounts', tags: [
      'wheelchair-mount', 'bed-mount', 'desk-mount', 'bathroom', 'kitchen',
      'vehicle', 'outdoors',
    ] },
  ],

  /* Delta B vocabularies (decisions E2, E4, G): curated ids, coarse on
     purpose; the note field absorbs edge cases. Extending goes through the
     proposal queue, not free text, or BOM summation and buildable-by-you
     stop meaning anything. */
  equipmentItems: [
    // Broad, common, recognizable. One id per big thing a household maker
    // might own, not a taxonomy of workshop gear. "Experience" entries count
    // too: buildable-by-you means "do I have what this takes", and for a
    // firmware work that is a skill, not a machine.
    '3d-printer',
    'soldering-iron',
    'hot-glue-gun',
    'basic-hand-tools',      // screwdrivers, pliers, hex keys, scissors
    'drill',
    'sewing-kit',
    'computer',
    'smartphone',
    'software-experience',
    'electronics-experience',
  ],
  materialItems: [
    // Same idea: the stuff, not the SKU. Length, size and grade go in the note.
    'filament',              // PLA, PETG, TPU, resin: whatever the printer eats
    'screws-and-bolts',
    'glue',                  // CA, epoxy, wood glue
    'velcro-and-straps',
    'foam-or-fabric',
    'wire',
    'small-electronics',     // servos, boards, batteries, switches
    'tape',
  ],
  materialUnits: ['g', 'kg', 'mm', 'cm', 'm', 'ml', 'l', 'count'],

  /* Delta C: software facets. Zero XP, pure discovery; the nine categories
     stay frozen and Software slices inside itself. */
  softwareFacets: ['server', 'database', 'firmware', 'driver', 'api', 'mobile', 'desktop', 'library', 'control-app', 'simulation', 'embedded'],

  // §8.1 novelty: file-set overlap above this ratio = version/fork, not new work.
  novelty: { overlapThreshold: 0.7 },

  // Computed badges (§7): pure functions over ledger + metrics. TUNE thresholds.
  badges: {
    newUserMaxAgeHours: 72,
    newUserMaxXp: 100,
    downloadTiers: [1000, 10000, 100000],
  },
};
