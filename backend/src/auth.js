import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Demo accounts. Passwords are listed in the README; only bcrypt hashes live here.
// The owner account maps to a real owner in the dataset so row-level scoping is visible.
const USERS = [
  { email: 'admin@company.com', role: 'admin', passwordHash: '$2b$10$ew0JITlMAdu1988pGFbeSuCp.82T8CAQnkixXZm6RRdNOW6P7Ye2y' },
  { email: 'user_3@company.com', role: 'owner', passwordHash: '$2b$10$g/MhJOaYfnoZ5UmYyJNwCO2t1qrbZQBR0mpnf3vSW4qm4snSlS2yS' },
  { email: 'viewer@company.com', role: 'viewer', passwordHash: '$2b$10$xRS8/yYme5pqba8tD9UyKOQVlw9lrvrtwQYMWDMP6l7DkTZfw/8Ge' },
];

export const ROLE_PERMISSIONS = {
  admin: ['health:read', 'reports:read', 'alerts:ack', 'costs:read', 'costs:read:all', 'dq:read', 'telemetry:write'],
  owner: ['health:read', 'reports:read', 'alerts:ack', 'costs:read'],
  viewer: ['health:read', 'reports:read'],
};

// Without JWT_SECRET a random secret is generated, so tokens simply expire on restart.
const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL = '8h';

const publicUser = ({ email, role }) => ({ email, role, permissions: ROLE_PERMISSIONS[role] });

export async function login(email, password) {
  const user = USERS.find((u) => u.email === String(email ?? '').toLowerCase().trim());
  // Compare against a hash even for unknown emails so response time doesn't reveal which accounts exist.
  const ok = await bcrypt.compare(String(password ?? ''), user?.passwordHash ?? USERS[0].passwordHash);
  if (!user || !ok) return null;
  return { token: jwt.sign({ sub: user.email, role: user.role }, SECRET, { expiresIn: TOKEN_TTL }), user: publicUser(user) };
}

export function verifyToken(token) {
  try {
    const { sub, role } = jwt.verify(token, SECRET);
    return ROLE_PERMISSIONS[role] ? publicUser({ email: sub, role }) : null;
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  const user = scheme === 'Bearer' ? verifyToken(token) : null;
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  req.user = user;
  next();
}

export const can = (user, permission) => user.permissions.includes(permission);

export const requirePermission = (permission) => (req, res, next) =>
  can(req.user, permission) ? next() : res.status(403).json({ error: `Missing permission: ${permission}` });
