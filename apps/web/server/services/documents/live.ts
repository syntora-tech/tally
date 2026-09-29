import 'server-only';
import { getDocumentStorage } from '../../storage';
import { documentServices } from '.';

export const { createDocument, uploadCv, attachSignedInvoice } =
  documentServices(getDocumentStorage);
