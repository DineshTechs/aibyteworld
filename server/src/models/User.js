import mongoose from 'mongoose';

export const ROLES = ['admin', 'editor', 'author'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 200 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'author', index: true },
    bio: { type: String, default: '', maxlength: 1000 },
    avatarUrl: { type: String, default: '' },
    // Public author profile: shown on the author page and in search results data.
    jobTitle: { type: String, default: '', maxlength: 100 },
    links: {
      website: { type: String, default: '' },
      linkedin: { type: String, default: '' },
      twitter: { type: String, default: '' },
      github: { type: String, default: '' },
    },
    active: { type: Boolean, default: true },
    // Incremented on password change / deactivation to invalidate older tokens.
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

export const LINK_KEYS = ['website', 'linkedin', 'twitter', 'github'];
export function publicLinks(links) {
  const out = {};
  for (const k of LINK_KEYS) out[k] = (links && links[k]) || '';
  return out;
}

userSchema.methods.toPublic = function toPublic() {
  return { id: this._id, name: this.name, bio: this.bio, avatarUrl: this.avatarUrl, jobTitle: this.jobTitle || '', links: publicLinks(this.links) };
};

userSchema.methods.toSafe = function toSafe() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    bio: this.bio,
    avatarUrl: this.avatarUrl,
    jobTitle: this.jobTitle || '',
    links: publicLinks(this.links),
    active: this.active,
    lastLoginAt: this.lastLoginAt,
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model('User', userSchema);
