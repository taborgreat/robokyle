/* The card shape the works grid uses, in one place: the works list, a user's
   profile and anything else that shows a row of works all read the same fields.
*/
const { inlineMimeFor } = require('./files');

const SORTS = {
  new: { createdAt: -1 },
  top: { upvoteCount: -1, createdAt: -1 },
  downloads: { downloadCount: -1, createdAt: -1 },
};

function cardPipeline({ match = {}, sort = 'new', skip = 0, limit = 20, viewerId = null }) {
  return [
    { $match: match },
    { $addFields: {
      upvoteCount: { $size: '$upvotes' },
      commentCount: { $size: '$comments' },
      // First image, if any, becomes the card thumbnail.
      thumbFile: { $first: { $filter: { input: '$files', as: 'f', cond: { $eq: ['$$f.kind', 'image'] } } } },
    } },
    { $sort: SORTS[sort] || SORTS.new },
    { $skip: skip },
    { $limit: limit },
    { $lookup: { from: 'users', localField: 'author', foreignField: '_id', as: 'author' } },
    { $unwind: '$author' },
    { $project: {
      id: '$_id', title: 1, description: 1, tags: 1, version: 1, createdAt: 1, updatedAt: 1,
      downloadCount: 1, upvoteCount: 1, commentCount: 1,
      author: { _id: 1, username: 1 },
      upvoted: viewerId ? { $in: [viewerId, '$upvotes'] } : { $literal: false },
      fileCount: { $size: '$files' },
      linkCount: { $size: { $ifNull: ['$links', []] } },
      guideSteps: { $size: { $ifNull: ['$guide.steps', []] } },
      thumbFileId: '$thumbFile._id',
      thumbName: '$thumbFile.originalName',
    } },
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

module.exports = { cardPipeline, shapeCards, SORTS };
