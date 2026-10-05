import 'server-only';
import { getDocumentStorage } from '../../storage';
import { tripExpenseServices } from '.';

export const { addTripExpense } = tripExpenseServices(getDocumentStorage);
