import express from 'express';
import { productionAuth, productionAdminOnly } from '../middlewares/production.middleware.js';
import { getAccountingConnection, checkAccountingConnection, getInboxInvoices } from '../controllers/accounting.controller.js';
const router = express.Router();
router.use(productionAuth, productionAdminOnly);
router.get('/connection', getAccountingConnection);
router.post('/connection/test', checkAccountingConnection);
router.get('/invoices', getInboxInvoices);
export default router;
