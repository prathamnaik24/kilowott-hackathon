import { Router } from 'express';
import { z } from 'zod';
import { findAtRiskOrders } from '../risk/risk.service.js';
import { getCustomer360, getCustomerTimeline, listCustomers, updateCustomerTags } from './customer.service.js';

export const customerRouter = Router();

const ListQuery = z.object({
  search: z.string().optional(),
  tag: z.string().optional(),
  minSpent: z.coerce.number().optional(),
  minOrders: z.coerce.number().optional(),
  sort: z.enum(['totalSpent', 'ordersCount', 'lastOrderAt', 'name']).optional(),
});

customerRouter.get('/', async (req, res) => {
  res.json({ data: await listCustomers(ListQuery.parse(req.query)) });
});

customerRouter.get('/:id', async (req, res) => {
  res.json({ data: await getCustomer360(req.params.id) });
});

customerRouter.get('/:id/timeline', async (req, res) => {
  res.json({ data: await getCustomerTimeline(req.params.id) });
});

customerRouter.get('/:id/risks', async (req, res) => {
  res.json({ data: await findAtRiskOrders({ customerId: req.params.id }) });
});

customerRouter.patch('/:id', async (req, res) => {
  const { tags } = z.object({ tags: z.array(z.string()) }).parse(req.body);
  res.json({ data: { tags: await updateCustomerTags(req.params.id, tags) } });
});
