import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { hitRateLimit, peekRateLimit, resetRateLimit } from '../../lib/rate-limit.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'AGENT';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, env.JWT_SECRET, { expiresIn: '12h' });
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.header('authorization')?.replace(/^Bearer /, '');
  if (!token) throw new HttpError(401, 'Authentication required');
  try {
    const { id, email, name, role } = jwt.verify(token, env.JWT_SECRET) as AuthUser;
    req.user = { id, email, name, role };
    next();
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }
}

export const requireRole =
  (...roles: AuthUser['role'][]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) throw new HttpError(403, 'Insufficient permissions');
    next();
  };

const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export const authRouter = Router();

/** Brute-force protection: failed attempts per (IP, email), counted in Redis so all API instances share it. */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_SECONDS = 15 * 60;

authRouter.post('/login', async (req, res) => {
  const { email, password } = LoginSchema.parse(req.body);
  const limitKey = `login:${req.ip}:${email.toLowerCase()}`;

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    const limit = await hitRateLimit(limitKey, LOGIN_MAX_FAILURES, LOGIN_WINDOW_SECONDS);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      throw new HttpError(429, `Too many failed login attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} min.`);
    }
    throw new HttpError(401, 'Invalid email or password');
  }
  // A correct password does not bypass an active lockout (otherwise the limit only slows guessing).
  if ((await peekRateLimit(limitKey)) >= LOGIN_MAX_FAILURES) {
    throw new HttpError(429, 'Too many failed login attempts. Try again later.');
  }
  await resetRateLimit(limitKey);
  const authUser: AuthUser = { id: user.id, email: user.email, name: user.name, role: user.role as AuthUser['role'] };
  res.json({ token: signToken(authUser), user: authUser });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
