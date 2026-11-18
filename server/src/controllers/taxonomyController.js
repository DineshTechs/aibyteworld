import { z } from 'zod';
import { Article, Category, Tag } from '../models/index.js';
import { logActivity } from '../services/activityService.js';
import { plainText, uniqueSlug } from '../utils/content.js';
import { asyncHandler, badRequest, notFound } from '../utils/http.js';

export const categorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  slug: z.string().trim().max(100).optional(),
  description: z.string().max(500).default(''),
});

export const tagSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  slug: z.string().trim().max(100).optional(),
});

// Builds list/create/update/delete handlers for Category and Tag.
function makeHandlers(Model, label, articleField) {
  const withCounts = async () => {
    const [docs, counts] = await Promise.all([
      Model.find().sort({ name: 1 }).lean(),
      Article.aggregate([{ $unwind: `$${articleField}` }, { $group: { _id: `$${articleField}`, n: { $sum: 1 } } }]),
    ]);
    const map = new Map(counts.map((c) => [String(c._id), c.n]));
    return docs.map((d) => ({ ...d, articleCount: map.get(String(d._id)) || 0 }));
  };

  const assign = async (doc, body) => {
    doc.name = plainText(body.name);
    if (!doc.name) throw badRequest('Name is required');
    doc.slug = await uniqueSlug(Model, body.slug || doc.slug || doc.name, doc._id);
    if ('description' in body) doc.description = plainText(body.description);
  };

  return {
    list: asyncHandler(async (_req, res) => res.json({ items: await withCounts() })),
    create: asyncHandler(async (req, res) => {
      const doc = new Model();
      await assign(doc, req.body);
      await doc.save();
      await logActivity(req, `${label}.create`, { entityType: Model.modelName, entityId: doc._id, summary: `Created ${label} "${doc.name}"` });
      res.status(201).json({ item: doc });
    }),
    update: asyncHandler(async (req, res) => {
      const doc = await Model.findById(req.params.id);
      if (!doc) throw notFound(`${Model.modelName} not found`);
      await assign(doc, req.body);
      await doc.save();
      await logActivity(req, `${label}.update`, { entityType: Model.modelName, entityId: doc._id, summary: `Updated ${label} "${doc.name}"` });
      res.json({ item: doc });
    }),
    remove: asyncHandler(async (req, res) => {
      const doc = await Model.findById(req.params.id);
      if (!doc) throw notFound(`${Model.modelName} not found`);
      // Keep articles consistent: detach the reference before deleting.
      await Article.updateMany({ [articleField]: doc._id }, { $pull: { [articleField]: doc._id } });
      await doc.deleteOne();
      await logActivity(req, `${label}.delete`, { entityType: Model.modelName, entityId: doc._id, summary: `Deleted ${label} "${doc.name}"` });
      res.status(204).end();
    }),
  };
}

export const categories = makeHandlers(Category, 'category', 'categories');
export const tags = makeHandlers(Tag, 'tag', 'tags');
