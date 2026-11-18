import mongoose from 'mongoose';

// A web page found during research. Content from the page is never stored or
// executed; only its address, title, publication date and reachability.
const researchSourceSchema = new mongoose.Schema(
  {
    job: { type: mongoose.Schema.Types.ObjectId, ref: 'ResearchJob', required: true, index: true },
    url: { type: String, required: true, maxlength: 2000 },
    domain: { type: String, default: '', maxlength: 300 },
    title: { type: String, default: '', maxlength: 300 },
    publishedAt: { type: Date },
    publishedAtSource: { type: String, enum: ['page', 'unknown'], default: 'unknown' },
    httpStatus: { type: Number },
    reachable: { type: Boolean },
    retrievedAt: { type: Date, default: Date.now },
    findingCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

researchSourceSchema.index({ job: 1, url: 1 }, { unique: true });

export const ResearchSource = mongoose.model('ResearchSource', researchSourceSchema);
