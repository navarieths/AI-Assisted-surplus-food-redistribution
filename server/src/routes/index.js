import { Router } from 'express';
import authRoutes from './auth.js';
import geoRoutes from './geo.js';
import listingRoutes from './listings.js';
import matchRoutes from './matches.js';
import taskRoutes from './tasks.js';
import volunteerRoutes from './volunteers.js';
import impactRoutes from './impact.js';
import notificationRoutes from './notifications.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/geo', geoRoutes);
router.use('/listings', listingRoutes);
router.use('/matches', matchRoutes);
router.use('/tasks', taskRoutes);
router.use('/volunteers', volunteerRoutes);
router.use('/impact', impactRoutes);
router.use('/notifications', notificationRoutes);

export default router;
