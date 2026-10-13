import { Router } from 'express';
import authRoutes from './auth.js';
import geoRoutes from './geo.js';
import listingRoutes from './listings.js';
import offerRoutes from './offers.js';
import assignmentRoutes from './assignments.js';
import volunteerRoutes from './volunteers.js';
import impactRoutes from './impact.js';
import notificationRoutes from './notifications.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/geo', geoRoutes);
router.use('/listings', listingRoutes);
router.use('/offers', offerRoutes);
router.use('/assignments', assignmentRoutes);
router.use('/volunteers', volunteerRoutes);
router.use('/impact', impactRoutes);
router.use('/notifications', notificationRoutes);

export default router;
