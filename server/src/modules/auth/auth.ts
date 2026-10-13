import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';

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

authRouter.post('/login', async (req, res) => {
  const { email, password } = LoginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(401, 'Invalid email or password');
  }
  const authUser: AuthUser = { id: user.id, email: user.email, name: user.name, role: user.role as AuthUser['role'] };
  res.json({ token: signToken(authUser), user: authUser });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
