import mongoose from 'mongoose';

const mediaSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true, unique: true },
    originalName: { type: String, default: '' },
    url: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    alt: { type: String, default: '', maxlength: 300 },
    // local: file in /uploads. remote: an image the source requires to be shown
    // from its own URL (Unsplash), so only the record is kept here.
    storage: { type: String, enum: ['local', 'remote'], default: 'local' },
    origin: { type: String, enum: ['upload', 'stock'], default: 'upload' },
    sourceId: { type: String, index: true }, // library photo ID, e.g. "pexels-123", so a photo is not reused
    width: { type: Number },
    height: { type: Number },
    // Credit shown under the picture (photographer and library).
    credit: {
      text: { type: String, default: '', maxlength: 300 },
      html: { type: String, default: '', maxlength: 1000 },
    },
    provider: { type: String, default: '' },
    // Smaller WebP copies made by the photo optimiser: [{ width, url, size }]
    variants: { type: [{ _id: false, width: Number, url: String, size: Number }], default: undefined },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  },
  { timestamps: true },
);

mediaSchema.index({ createdAt: -1 });

export const Media = mongoose.model('Media', mediaSchema);
