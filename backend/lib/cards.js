/* The card shape the works grid uses, in one place: the works list, a user's
   profile and anything else that shows a row of works all read the same fields.
*/
const { inlineMimeFor } = require('./files');

const SORTS = {
  new: { createdAt: -1 },
  top: { upvoteCount: -1, createdAt: -1 },
  downloads: { downloadCount: -1, createdAt: -1 },
};

// Verified Produced count — "Produced N times" is arguably the strongest
// trust signal on the site (Part II §4). Counts the sweep-maintained cache.
const producedLookup = [
  { $lookup: {
    from: 'producedentries', as: 'producedDocs',
    let: { id: '$_id' },
    pipeline: [
      { $match: { $expr: { $and: [{ $eq: ['$work', '$$id'] }, { $eq: ['$cachedState', 'verified'] }] } } },
      { $count: 'n' },
    ],
  } },
  { $addFields: { producedCount: { $ifNull: [{ $first: '$producedDocs.n' }, 0] } } },
];

/* The stages every card list ends with: comment counts (their collection is
   models/Comment.js; counted after the page is cut so the lookup only runs
   for the cards being shown), the author, and the one projection. */
const tailStages = (viewerId) => [
  { $lookup: {
    from: 'comments', as: 'commentDocs',
    let: { id: '$_id' },
    pipeline: [
      { $match: { $expr: { $and: [
        { $eq: ['$targetType', 'design'] }, { $eq: ['$target', '$$id'] }, { $eq: ['$deletedAt', null] },
      ] } } },
      { $count: 'n' },
    ],
  } },
  { $addFields: { commentCount: { $ifNull: [{ $first: '$commentDocs.n' }, 0] } } },
  { $lookup: { from: 'users', localField: 'author', foreignField: '_id', as: 'author' } },
  { $unwind: '$author' },
  { $project: {
    id: '$_id', title: 1, description: 1, tags: 1, version: 1, createdAt: 1, updatedAt: 1,
    downloadCount: 1, upvoteCount: 1, commentCount: 1, producedCount: 1, depth: 1, categories: 1, needTags: 1,
    type: 1,
    remixNote: 1, parent: 1,
    familyCount: { $ifNull: ['$familyCount', null] },
    portName: '$standard.portName',
    // The standards this work provides, as bare ids — enough for the
    // wizard's mate-check without dragging whole declarations into cards.
    providesStandards: { $ifNull: ['$ports.provides.standard', []] },
    requiredEquipment: { $ifNull: ['$requires.equipment.item', []] },
    facets: 1,
    author: { _id: 1, username: 1 },
    upvoted: viewerId ? { $in: [viewerId, { $ifNull: ['$upvotes.user', []] }] } : { $literal: false },
    fileCount: { $add: [
      { $size: '$files' },
      { $sum: { $map: { input: { $ifNull: ['$steps', []] }, as: 's', in: { $size: { $ifNull: ['$$s.attachments', []] } } } } },
    ] },
    linkCount: { $size: { $ifNull: ['$links', []] } },
    guideSteps: { $size: { $ifNull: ['$steps', []] } },
    thumbFileId: '$thumbFile._id',
    thumbName: '$thumbFile.originalName',
  } },
];

function cardPipeline({ match = {}, sort = 'new', skip = 0, limit = 20, viewerId = null }) {
  return [
    { $match: match },
    { $addFields: {
      upvoteCount: { $size: '$upvotes' },
      // First image, if any, becomes the card thumbnail.
      thumbFile: { $first: { $filter: { input: '$files', as: 'f', cond: { $eq: ['$$f.kind', 'image'] } } } },
    } },
    { $sort: SORTS[sort] || SORTS.new },
    { $skip: skip },
    { $limit: limit },
    ...producedLookup,
    ...tailStages(viewerId),
  ];
}

/* Family-aware browse: one card per family, the representative being the
   member with the most verified builds, the root breaking ties. The stack
   badge (familyCount) says how many siblings stand behind the card. The
   produced lookup runs before grouping here, so this pipeline is heavier
   per row than cardPipeline — fine at collection scale, revisit if browse
   ever slows. */
function familyCardPipeline({ match = {}, sort = 'new', skip = 0, limit = 20, viewerId = null }) {
  return [
    { $match: match },
    ...producedLookup,
    { $addFields: {
      upvoteCount: { $size: '$upvotes' },
      thumbFile: { $first: { $filter: { input: '$files', as: 'f', cond: { $eq: ['$$f.kind', 'image'] } } } },
      rootKey: { $ifNull: ['$root', '$_id'] },
      isRoot: { $cond: [{ $gt: [{ $ifNull: ['$depth', 0] }, 0] }, 0, 1] },
    } },
    { $sort: { producedCount: -1, isRoot: -1, createdAt: 1 } },
    { $group: { _id: '$rootKey', doc: { $first: '$$ROOT' }, familyCount: { $sum: 1 } } },
    { $replaceRoot: { newRoot: { $mergeObjects: ['$doc', { familyCount: '$familyCount' }] } } },
    { $sort: SORTS[sort] || SORTS.new },
    { $skip: skip },
    { $limit: limit },
    ...tailStages(viewerId),
  ];
}

// Turns the raw thumbnail ids into a URL the browser can use.
function shapeCards(items) {
  return items.map(d => {
    const { thumbFileId, thumbName, ...rest } = d;
    return {
      ...rest,
      thumbUrl: thumbFileId && inlineMimeFor(thumbName) ? `/api/designs/${d.id}/files/${thumbFileId}/view` : null,
    };
  });
}

module.exports = { cardPipeline, familyCardPipeline, shapeCards, SORTS };
