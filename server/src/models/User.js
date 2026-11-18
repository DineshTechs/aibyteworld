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
    active: { type: Boolean, default: true },
    // Incremented on password change / deactivation to invalidate older tokens.
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

userSchema.methods.toPublic = function toPublic() {
  return { id: this._id, name: this.name, bio: this.bio, avatarUrl: this.avatarUrl };
};

userSchema.methods.toSafe = function toSafe() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    bio: this.bio,
    avatarUrl: this.avatarUrl,
    active: this.active,
    lastLoginAt: this.lastLoginAt,
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model('User', userSchema);
